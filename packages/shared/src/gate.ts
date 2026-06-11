import { z } from "zod";
import { PaymentIntent } from "./intent.js";
import { ComplianceResult, RiskResult, RouteResult } from "./services.js";

/**
 * Policy Gate I/O (SPEC §5.7). The gate is a PURE function (I3):
 * identical GateInput -> identical GateDecision. No I/O, clock, or RNG inside.
 */

/** Versioned thresholds sourced from ops/config/policy.yaml. */
export const PolicyConfig = z.object({
  version: z.string(),
  auto_max_rlusd: z.number(),
  risk_veto_threshold: z.number(),
  slippage_tolerance: z.number(),
  uncredentialed_action: z.enum(["VETO", "BLOCK"]),
  hot_float_cap_rlusd: z.number(),
});
export type PolicyConfig = z.infer<typeof PolicyConfig>;

export const GateInput = z.object({
  intent: PaymentIntent,
  amount_rlusd_eq: z.number(), // amount normalized to RLUSD-equivalent
  compliance: ComplianceResult,
  risk: RiskResult,
  route: RouteResult,
  hot_float_headroom_rlusd: z.number(), // live remaining headroom (I5)
  policy: PolicyConfig,
});
export type GateInput = z.infer<typeof GateInput>;

export const GateOutcome = z.enum(["AUTO", "VETO", "BLOCK"]);
export type GateOutcome = z.infer<typeof GateOutcome>;

/** matched_rule values mirror the decision order in SPEC §5.7. */
export const MatchedRule = z.enum([
  "sanctioned", // 1 -> BLOCK
  "uncredentialed", // 2 -> VETO (config can escalate to BLOCK)
  "no_route_or_slippage", // 3 -> VETO
  "risk", // 4 -> VETO (degraded or score >= threshold)
  "over_auto_max", // 5 -> VETO
  "over_float_headroom", // 6 -> VETO
  "auto", // 7 -> AUTO
]);
export type MatchedRule = z.infer<typeof MatchedRule>;

export const GateDecision = z.object({
  outcome: GateOutcome,
  matched_rule: MatchedRule,
  config_version: z.string(),
  input_hash: z.string(), // hash of the GateInput snapshot — replayability IS the audit story
});
export type GateDecision = z.infer<typeof GateDecision>;
