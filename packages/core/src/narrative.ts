import type { PipelineRecord } from "@fx/shared";

/**
 * Deterministic reviewer narrative (SPEC §5.11 fallback path). The AI Explainer (P5) may
 * REPLACE this text asynchronously, but the queue never waits on an LLM: this template is
 * always attached at enqueue time, built only from audited pipeline fields (I1).
 */
export function templateNarrative(rec: PipelineRecord): string {
  const { intent, compliance, risk, route, decision, amount_rlusd_eq } = rec;
  const lines: string[] = [];

  lines.push(
    `${intent.amount.value} ${intent.amount.currency} (~${amount_rlusd_eq.toFixed(2)} RLUSD-eq) to ` +
      `${intent.beneficiary.name ?? intent.beneficiary.address}` +
      (intent.purpose ? ` for "${intent.purpose}".` : "."),
  );

  switch (decision.matched_rule) {
    case "uncredentialed":
      lines.push(
        compliance.credential_found
          ? "The counterparty's KYC credential exists but has not been accepted on-ledger."
          : "No on-ledger KYC credential was found for this counterparty.",
      );
      break;
    case "no_route_or_slippage":
      lines.push(
        route.no_route
          ? "No viable route was found on the DEX/AMMs for this delivery."
          : "Routing succeeded but slippage exceeds the policy tolerance.",
      );
      break;
    case "risk": {
      const top = [...risk.shap].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3);
      const drivers = top.map((s) => `${s.feature} (${s.contribution >= 0 ? "+" : ""}${s.contribution.toFixed(2)})`);
      lines.push(
        risk.degraded
          ? "The risk service was unavailable; the conservative fail-closed score forced review."
          : `Risk score ${risk.score.toFixed(2)} is at/above the veto threshold. Top drivers: ${drivers.join(", ") || "n/a"}.`,
      );
      break;
    }
    case "over_auto_max":
      lines.push("Amount exceeds the AUTO ceiling; payments this size require human + device sign-off.");
      break;
    case "over_float_headroom":
      lines.push("Amount exceeds the remaining hot-wallet float headroom (I5).");
      break;
    default:
      lines.push(`Routed to ${decision.outcome} by rule "${decision.matched_rule}".`);
  }

  if (!route.no_route) {
    lines.push(
      `Route quote: cost ${route.quoted_cost.toFixed(4)}, SendMax cap ${route.send_max.toFixed(4)} ` +
        `(slippage ${(route.slippage_tolerance * 100).toFixed(1)}%).`,
    );
  }
  lines.push(`Decision is replayable: policy ${decision.config_version}, input hash ${decision.input_hash.slice(0, 12)}….`);
  return lines.join(" ");
}
