import { createHash } from "node:crypto";
import { encode, encodeForSigning, type Payment } from "xrpl";
import { ulid } from "ulid";
import type { PaymentIntent, QueueItem, SignResponse } from "@fx/shared";
import { appendAudit } from "./audit.js";
import { config, loadPolicy, explorerTxUrl } from "./config.js";
import { xrplClient } from "./xrpl/client.js";
import { intentDeliverAmount, toRlusdEquivalent } from "./amounts.js";
import { coldTreasuryAddress, hotWallet } from "./wallets.js";
import { findRoute, type XrplAmount } from "./routing.js";
import { verifyDeviceSignature } from "./device-verify.js";
import { submitSignedBlobAudited, txResultCode } from "./submit.js";
import { getIntent, getQueueItem, getPipelineRecord, savePipelineRecord, saveQueueItem, transitionQueueItem, updateIntentStatus } from "./repo.js";
import { recordFloatRefill } from "./float.js";
import { emitFx } from "./events.js";

/**
 * VETO path (SPEC §5.9) — the demo centerpiece. Signing happens at APPROVAL time, never
 * queue time (txns expire during human review): fetch fresh Sequence, set
 * LastLedgerSequence ≈ current+40, build the unsigned Payment from COLD_TREASURY with the
 * device pubkey as SigningPubKey, send the digest to the device, local-verify the returned
 * low-S DER signature, then submit. One auto-rebuild on a lapsed window, then back to pending.
 */

const BRIDGE = () => `http://127.0.0.1:${config.bridgeHttpPort}`;
const SIGNING_WINDOW_LEDGERS = 40; // ~2–3 min at ~4 s/ledger

function hex(s: string): string {
  return Buffer.from(s, "utf8").toString("hex").toUpperCase();
}

function sha512Half(dataHex: string): string {
  return createHash("sha512").update(Buffer.from(dataHex, "hex")).digest().subarray(0, 32).toString("hex").toUpperCase();
}

async function deviceInfo(): Promise<{ pubkey: string; simulated: boolean }> {
  const res = await fetch(`${BRIDGE()}/device/info`);
  if (!res.ok) throw new Error(`bridge /device/info ${res.status} — is the bridge running?`);
  return (await res.json()) as { pubkey: string; simulated: boolean };
}

/** Build the unsigned COLD payment for this intent with a fresh signing window. */
async function buildColdPayment(intent: PaymentIntent, pubkey: string): Promise<Payment> {
  const client = await xrplClient();
  const cold = coldTreasuryAddress();
  const deliverAmount = intentDeliverAmount(intent);

  const tx: Payment = {
    TransactionType: "Payment",
    Account: cold,
    Destination: intent.beneficiary.address,
    Amount: deliverAmount as never,
    Memos: [{ Memo: { MemoType: hex("intent_id"), MemoData: hex(intent.id) } }],
  };

  // EUD deliveries are funded from COLD's RLUSD via a FRESH route quote (queue-time quotes
  // are stale by approval time). RLUSD / XRP deliveries are direct same-asset payments.
  if (intent.amount.currency === "EUD") {
    const policy = loadPolicy();
    const quote = await findRoute({
      source: cold,
      destination: intent.beneficiary.address,
      destinationAmount: deliverAmount,
      slippageTolerance: policy.slippage_tolerance,
      sourceCurrencies: [{ currency: config.rlusdHex, issuer: config.rlusdIssuer }],
      bridgeVia: { currency: "XRP" },
    });
    if (quote.result.no_route) throw new Error("no route from COLD for EUD delivery");
    tx.SendMax = quote.sendMaxAmount as never;
    if (quote.paths.length) (tx as { Paths?: unknown }).Paths = quote.paths as never;
  }

  const prepared = (await client.autofill(tx)) as Payment;
  prepared.LastLedgerSequence = (await client.getLedgerIndex()) + SIGNING_WINDOW_LEDGERS;
  prepared.SigningPubKey = pubkey;
  return prepared;
}

export interface VetoApprovalResult {
  state: QueueItem["state"];
  tx_hash?: string;
  explorer_url?: string;
  detail?: string;
}

export async function approveVeto(intentId: string, approver: string): Promise<VetoApprovalResult> {
  const item = getQueueItem(intentId);
  const intent = getIntent(intentId);
  if (!item || !intent) throw new Error(`no queue item for intent ${intentId}`);
  if (item.state !== "pending") throw new Error(`queue item is ${item.state}, expected pending`);

  appendAudit({
    intent_id: intentId,
    actor: approver,
    event: "veto.approved",
    payload: { approver },
  });

  let attempt = await signAndSubmit(intentId, intent, item, approver);
  if (attempt.expired) {
    // Lapsed signing window: rebuild once with a fresh window (SPEC §5.9 step 3).
    appendAudit({
      intent_id: intentId,
      actor: "system",
      event: "veto.window_lapsed",
      payload: { retry: true },
    });
    const fresh = getQueueItem(intentId);
    if (fresh) attempt = await signAndSubmit(intentId, intent, fresh, approver, true);
  }
  return attempt.result;
}

interface SignAttempt {
  expired: boolean;
  result: VetoApprovalResult;
}

async function signAndSubmit(
  intentId: string,
  intent: PaymentIntent,
  item: QueueItem,
  approver: string,
  isRetry = false,
): Promise<SignAttempt> {
  const info = await deviceInfo();
  const prepared = await buildColdPayment(intent, info.pubkey);
  const digest = sha512Half(encodeForSigning(prepared as never));
  const requestId = ulid();

  let current = transitionQueueItem(item, "awaiting_device", isRetry ? "rebuilt after lapsed window" : undefined);
  emitFx("queue.updated", intentId, current);
  appendAudit({
    intent_id: intentId,
    actor: "system",
    event: "veto.sign_requested",
    payload: { request_id: requestId, digest, tx: prepared as unknown as Record<string, unknown>, simulated: info.simulated },
  });

  const signRes = await fetch(`${BRIDGE()}/device/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: requestId,
      digest_hex: digest,
      display: {
        destination: intent.beneficiary.address,
        amount: String(intent.amount.value),
        currency: intent.amount.currency,
        purpose: intent.purpose || "(no purpose)",
      },
      timeout_ms: 120_000,
    }),
  });
  if (!signRes.ok) throw new Error(`bridge /device/sign ${signRes.status}`);
  const sign = (await signRes.json()) as SignResponse;

  if (sign.outcome !== "SIGNED" || !sign.signature_der_hex) {
    const note = sign.outcome === "TIMEOUT" ? "device timeout" : "rejected on device";
    current = transitionQueueItem(current, "rejected", note);
    updateIntentStatus(intentId, "rejected");
    appendAudit({ intent_id: intentId, actor: "device", event: "veto.device_rejected", payload: { outcome: sign.outcome } });
    emitFx("queue.updated", intentId, current);
    return { expired: false, result: { state: "rejected", detail: note } };
  }

  // Local-verify against the device pubkey BEFORE submit (SPEC §0.3 rule 2).
  if (!verifyDeviceSignature(digest, sign.signature_der_hex, info.pubkey)) {
    current = transitionQueueItem(current, "rejected", "signature failed local verification");
    updateIntentStatus(intentId, "rejected");
    appendAudit({ intent_id: intentId, actor: "system", event: "veto.bad_signature", payload: { request_id: requestId } });
    emitFx("queue.updated", intentId, current);
    return { expired: false, result: { state: "rejected", detail: "bad signature" } };
  }

  current = transitionQueueItem(current, "signed", `device signature verified (request ${requestId})`);
  appendAudit({ intent_id: intentId, actor: "device", event: "veto.signed", payload: { request_id: requestId } });
  emitFx("queue.updated", intentId, current);

  const signedTx = { ...prepared, TxnSignature: sign.signature_der_hex };
  const blob = encode(signedTx as never);

  try {
    const res = await submitSignedBlobAudited("veto.exec", blob, prepared.Account, intentId);
    const code = txResultCode(res);
    if (code !== "tesSUCCESS") throw new Error(code);
    const hash = res.result.hash;
    current = transitionQueueItem(current, "settled", `tesSUCCESS ${hash}`);
    current = { ...current, tx_hash: hash, explorer_url: explorerTxUrl(hash) };
    saveQueueItem(current);
    updateIntentStatus(intentId, "settled");
    const rec = getPipelineRecord(intentId);
    if (rec) {
      rec.tx_hash = hash;
      rec.explorer_url = explorerTxUrl(hash);
      rec.intent.status = "settled";
      savePipelineRecord(rec);
    }
    // A COLD -> HOT transfer is a float refill: raise headroom (SPEC §5.12 beat).
    if (intent.beneficiary.address === hotWallet().address) {
      recordFloatRefill(intentId, toRlusdEquivalent(intent.amount.value, intent.amount.currency), "veto refill");
    }
    emitFx("queue.updated", intentId, current);
    return {
      expired: false,
      result: { state: "settled", tx_hash: hash, explorer_url: explorerTxUrl(hash) },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const expired = /tefMAX_LEDGER|LastLedgerSequence/i.test(msg);
    if (expired && !isRetry) {
      const back = transitionQueueItem(current, "pending", "signing window lapsed — will rebuild");
      emitFx("queue.updated", intentId, back);
      return { expired: true, result: { state: "pending", detail: msg } };
    }
    const back = transitionQueueItem(current, "pending", `submit failed: ${msg}`);
    updateIntentStatus(intentId, "veto");
    appendAudit({ intent_id: intentId, actor: "system", event: "veto.submit_failed", payload: { error: msg } });
    emitFx("queue.updated", intentId, back);
    return { expired: false, result: { state: "pending", detail: msg } };
  }
}

export function rejectVeto(intentId: string, who: string, reason = "rejected from dashboard"): QueueItem {
  const item = getQueueItem(intentId);
  if (!item) throw new Error(`no queue item for intent ${intentId}`);
  if (item.state !== "pending") throw new Error(`queue item is ${item.state}, expected pending`);
  const next = transitionQueueItem(item, "rejected", reason);
  updateIntentStatus(intentId, "rejected");
  appendAudit({ intent_id: intentId, actor: who, event: "veto.rejected", payload: { reason } });
  emitFx("queue.updated", intentId, next);
  return next;
}
