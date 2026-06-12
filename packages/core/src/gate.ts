import type { GateInput, GateOutcome, MatchedRule } from "@fx/shared";

/**
 * Policy Gate (SPEC §5.7, I3) — a PURE function. Identical GateInput -> identical result.
 *
 * INVARIANT (I3, lint/review check): this module imports NOTHING at runtime — the single
 * import above is type-only and erased at compile time. No I/O, no clock, no randomness,
 * no config reads. Thresholds arrive inside `input.policy` (versioned ops/config/policy.yaml).
 * The `input_hash` lives in decideGate (gate-decision.ts) so this file stays dependency-free.
 *
 * Decision order (first match wins — SPEC §5.7):
 *   1.  sanctioned                                  -> BLOCK
 *   1b. compliance degraded (service failed)        -> BLOCK  (fail-closed, SPEC §5.3)
 *   2.  credential not accepted                     -> VETO (policy can escalate to BLOCK)
 *   3.  no route / routing degraded / slippage      -> VETO
 *   4.  risk degraded or score >= threshold         -> VETO
 *   5.  amount > auto_max                           -> VETO
 *   6.  amount > hot float headroom                 -> VETO  (I5)
 *   7.  else                                        -> AUTO
 */
export interface GateEvaluation {
  outcome: GateOutcome;
  matched_rule: MatchedRule;
  config_version: string;
}

export function evaluateGate(input: GateInput): GateEvaluation {
  const { compliance, risk, route, policy, amount_rlusd_eq, hot_float_headroom_rlusd } = input;
  const v = policy.version;

  // 1. Hard stop: sanctioned counterparty. Nothing moves.
  if (compliance.sanctioned) {
    return { outcome: "BLOCK", matched_rule: "sanctioned", config_version: v };
  }
  // 1b. Compliance service failure -> forced BLOCK (fail-closed, never "assume clean").
  if (compliance.degraded) {
    return { outcome: "BLOCK", matched_rule: "compliance_degraded", config_version: v };
  }
  // 2. No accepted XLS-70 credential -> VETO (or BLOCK if policy escalates).
  if (!compliance.credential_accepted) {
    return { outcome: policy.uncredentialed_action, matched_rule: "uncredentialed", config_version: v };
  }
  // 3. Unroutable, routing degraded, or quote slippage looser than policy allows.
  if (route.no_route || route.degraded || route.slippage_tolerance > policy.slippage_tolerance) {
    return { outcome: "VETO", matched_rule: "no_route_or_slippage", config_version: v };
  }
  // 4. Risk service degraded (conservative 0.99 upstream) or score at/over threshold.
  if (risk.degraded || risk.score >= policy.risk_veto_threshold) {
    return { outcome: "VETO", matched_rule: "risk", config_version: v };
  }
  // 5. Above the AUTO ceiling -> human + device.
  if (amount_rlusd_eq > policy.auto_max_rlusd) {
    return { outcome: "VETO", matched_rule: "over_auto_max", config_version: v };
  }
  // 6. Above remaining hot-float headroom -> the gate refuses AUTO (I5).
  if (amount_rlusd_eq > hot_float_headroom_rlusd) {
    return { outcome: "VETO", matched_rule: "over_float_headroom", config_version: v };
  }
  // 7. Small, clean, routable, within float -> AUTO.
  return { outcome: "AUTO", matched_rule: "auto", config_version: v };
}
