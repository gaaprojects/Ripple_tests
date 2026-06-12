import { RiskResult, type PaymentIntent } from "@fx/shared";
import { config } from "./config.js";
import { intentVelocity, isNewCounterparty } from "./repo.js";

/**
 * Node adapter for services/risk (SPEC §5.5). Timeout + zod validation + fail-closed
 * fallback: any failure returns score 0.99 flagged degraded -> the gate VETOes (SPEC §5.3).
 */

const RISK_TIMEOUT_MS = 4500;

export interface RiskFeatures {
  intent_id: string;
  amount_rlusd_eq: number;
  corridor: string | null;
  new_counterparty: boolean;
  velocity_1h: number;
  velocity_24h: number;
  hour_of_day: number;
  amount_to_float_ratio: number;
}

export function buildRiskFeatures(
  intent: PaymentIntent,
  amountRlusdEq: number,
  floatCapRlusd: number,
): RiskFeatures {
  return {
    intent_id: intent.id,
    amount_rlusd_eq: amountRlusdEq,
    corridor: intent.corridor ?? null,
    new_counterparty: isNewCounterparty(intent.beneficiary.address, intent.id),
    velocity_1h: intentVelocity(intent.id, 60 * 60 * 1000),
    velocity_24h: intentVelocity(intent.id, 24 * 60 * 60 * 1000),
    hour_of_day: new Date().getUTCHours(),
    amount_to_float_ratio: floatCapRlusd > 0 ? amountRlusdEq / floatCapRlusd : 1,
  };
}

export function degradedRiskResult(reason: string): RiskResult {
  return {
    score: 0.99,
    model_version: `degraded (${reason})`,
    shap: [],
    degraded: true,
    checked_at: new Date().toISOString(),
  };
}

export async function scoreRisk(features: RiskFeatures): Promise<RiskResult> {
  try {
    const res = await fetch(`${config.riskServiceUrl}/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(features),
      signal: AbortSignal.timeout(RISK_TIMEOUT_MS),
    });
    if (!res.ok) return degradedRiskResult(`risk service HTTP ${res.status}`);
    const parsed = RiskResult.safeParse(await res.json());
    if (!parsed.success) return degradedRiskResult("schema-invalid risk response");
    return parsed.data;
  } catch {
    return degradedRiskResult("risk service unreachable");
  }
}
