import type { ComplianceResult, GateInput, PaymentIntent, PipelineRecord, QueueItem, RouteResult } from "@fx/shared";
import { appendAudit } from "./audit.js";
import { loadPolicy, config } from "./config.js";
import { runCompliance } from "./compliance.js";
import { buildRiskFeatures, scoreRisk } from "./risk-client.js";
import { findRoute, type RouteQuote } from "./routing.js";
import { decideGate } from "./gate-decision.js";
import { executeAuto } from "./auto-executor.js";
import { floatHeadroomRlusd, recordFloatSpend } from "./float.js";
import { toRlusdEquivalent, intentDeliverAmount } from "./amounts.js";
import { hotWallet, complianceIssuerAddress } from "./wallets.js";
import { saveIntent, updateIntentStatus, savePipelineRecord, saveQueueItem } from "./repo.js";
import { templateNarrative } from "./narrative.js";
import { emitFx } from "./events.js";

/**
 * Pipeline Controller (SPEC §5.3) — a deterministic orchestrator, NOT an agent loop.
 * Per intent: persist → Compliance ∥ Risk ∥ Routing (per-service timeout, fail-closed
 * fallbacks) → GateInput → pure Policy Gate → dispatch → audit at every step.
 * No LLM anywhere in this path (I1).
 */

const SERVICE_TIMEOUT_MS = 5000;

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback()), ms);
      }),
    ]);
  } catch {
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}

function degradedCompliance(): ComplianceResult {
  return {
    sanctioned: false,
    credential_found: false,
    credential_accepted: false,
    sources: [],
    degraded: true, // gate -> forced BLOCK
    checked_at: new Date().toISOString(),
  };
}

function degradedRoute(slippage: number): { result: RouteResult } & Pick<RouteQuote, "sourceAmount" | "sendMaxAmount" | "paths"> {
  return {
    result: {
      paths: [],
      quoted_cost: 0,
      send_max: 0,
      slippage_tolerance: slippage,
      no_route: true,
      degraded: true, // gate -> VETO with no-route flag
      checked_at: new Date().toISOString(),
    },
    sourceAmount: "0",
    sendMaxAmount: "0",
    paths: [],
  };
}

export async function runPipeline(intent: PaymentIntent): Promise<PipelineRecord> {
  const policy = loadPolicy();
  const pending: PaymentIntent = { ...intent, status: "pending" };
  saveIntent(pending);
  appendAudit({
    intent_id: intent.id,
    actor: intent.source === "agent" ? "agent" : intent.created_by,
    event: "intent.received",
    payload: { intent: pending },
  });
  emitFx("intent.received", intent.id, pending);

  const amountRlusdEq = toRlusdEquivalent(intent.amount.value, intent.amount.currency);
  const hot = hotWallet();
  const deliverAmount = intentDeliverAmount(intent);

  // The three services run in parallel; each degrades independently (SPEC §5.3).
  const [compliance, risk, quote] = await Promise.all([
    withTimeout(
      runCompliance({
        destination: intent.beneficiary.address,
        beneficiaryName: intent.beneficiary.name,
        complianceIssuer: complianceIssuerAddress(),
      }),
      SERVICE_TIMEOUT_MS,
      degradedCompliance,
    ),
    withTimeout(
      (async () => scoreRisk(buildRiskFeatures(intent, amountRlusdEq, policy.hot_float_cap_rlusd)))(),
      SERVICE_TIMEOUT_MS,
      () => ({
        score: 0.99,
        model_version: "degraded (timeout)",
        shap: [],
        degraded: true,
        checked_at: new Date().toISOString(),
      }),
    ),
    withTimeout(
      findRoute({
        source: hot.address,
        destination: intent.beneficiary.address,
        destinationAmount: deliverAmount,
        slippageTolerance: policy.slippage_tolerance,
        // HOT funds AUTO payments in RLUSD; the XRP bridge covers RLUSD→XRP→EUD.
        sourceCurrencies:
          intent.amount.currency === "RLUSD" || intent.amount.currency === "EUD"
            ? [{ currency: config.rlusdHex, issuer: config.rlusdIssuer }]
            : [{ currency: "XRP" }],
        bridgeVia: { currency: "XRP" },
      }),
      SERVICE_TIMEOUT_MS + 3000, // path_find can be slower than the local services
      () => degradedRoute(policy.slippage_tolerance),
    ),
  ]);

  appendAudit({
    intent_id: intent.id,
    actor: "system",
    event: "pipeline.services",
    payload: { compliance, risk, route: quote.result },
  });
  emitFx("pipeline.services", intent.id, { compliance, risk, route: quote.result });

  const gateInput: GateInput = {
    intent: pending,
    amount_rlusd_eq: amountRlusdEq,
    compliance,
    risk,
    route: quote.result,
    hot_float_headroom_rlusd: floatHeadroomRlusd(policy.hot_float_cap_rlusd),
    policy,
  };
  const decision = decideGate(gateInput);
  appendAudit({
    intent_id: intent.id,
    actor: "system",
    event: "gate.decided",
    payload: { decision, gate_input: gateInput as unknown as Record<string, unknown> },
  });
  emitFx("gate.decided", intent.id, decision);

  const record: PipelineRecord = {
    intent: pending,
    amount_rlusd_eq: amountRlusdEq,
    compliance,
    risk,
    route: quote.result,
    decision,
  };

  if (decision.outcome === "AUTO") {
    record.intent = { ...pending, status: "auto" };
    updateIntentStatus(intent.id, "auto");
    savePipelineRecord(record);
    try {
      // I5 belt-and-braces: the gate already checked headroom; the executor refuses too.
      if (amountRlusdEq > floatHeadroomRlusd(policy.hot_float_cap_rlusd)) {
        throw new Error("float headroom exhausted between gate and executor");
      }
      const res = await executeAuto({
        wallet: hot,
        destination: intent.beneficiary.address,
        deliverAmount,
        sendMax: quote.sendMaxAmount,
        paths: quote.paths,
        intentId: intent.id,
      });
      recordFloatSpend(intent.id, amountRlusdEq);
      record.intent = { ...pending, status: "settled" };
      record.tx_hash = res.hash;
      record.explorer_url = res.explorer;
      updateIntentStatus(intent.id, "settled");
      emitFx("exec.settled", intent.id, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record.intent = { ...pending, status: "failed" };
      record.exec_error = msg;
      updateIntentStatus(intent.id, "failed");
      appendAudit({ intent_id: intent.id, actor: "system", event: "exec.failed", payload: { error: msg } });
      emitFx("exec.failed", intent.id, { error: msg });
    }
  } else if (decision.outcome === "VETO") {
    record.intent = { ...pending, status: "veto" };
    updateIntentStatus(intent.id, "veto");
    savePipelineRecord(record);
    const item: QueueItem = {
      intent_id: intent.id,
      state: "pending",
      narrative: templateNarrative(record),
      transitions: [{ state: "pending", at: new Date().toISOString(), note: `rule: ${decision.matched_rule}` }],
    };
    saveQueueItem(item);
    appendAudit({ intent_id: intent.id, actor: "system", event: "queue.enqueued", payload: { item } });
    emitFx("queue.enqueued", intent.id, item);
  } else {
    record.intent = { ...pending, status: "blocked" };
    updateIntentStatus(intent.id, "blocked");
    appendAudit({
      intent_id: intent.id,
      actor: "system",
      event: "intent.blocked",
      payload: { rule: decision.matched_rule },
    });
    emitFx("intent.blocked", intent.id, decision);
  }

  savePipelineRecord(record);
  return record;
}
