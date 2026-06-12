import { z } from "zod";
import { PaymentIntent } from "./intent.js";
import { ComplianceResult, RiskResult, RouteResult } from "./services.js";
import { GateDecision } from "./gate.js";

/**
 * One intent's full pass through the Pipeline Controller (SPEC §5.3) — the unit the
 * dashboard feed renders and the golden-file replay test asserts on.
 */
export const PipelineRecord = z.object({
  intent: PaymentIntent,
  amount_rlusd_eq: z.number(),
  compliance: ComplianceResult,
  risk: RiskResult,
  route: RouteResult,
  decision: GateDecision,
  // Execution outcome, present once the AUTO executor or VETO approval settles.
  tx_hash: z.string().optional(),
  explorer_url: z.string().optional(),
  exec_error: z.string().optional(),
});
export type PipelineRecord = z.infer<typeof PipelineRecord>;

/** Treasury snapshot for the dashboard (SPEC §5.14). */
export const TreasuryState = z.object({
  hot_address: z.string(),
  cold_address: z.string(),
  hot_xrp: z.number(),
  hot_rlusd: z.number(),
  hot_eud: z.number(),
  cold_xrp: z.number(),
  cold_rlusd: z.number(),
  float_cap_rlusd: z.number(),
  float_used_rlusd: z.number(),
  float_headroom_rlusd: z.number(),
  checked_at: z.string(),
});
export type TreasuryState = z.infer<typeof TreasuryState>;
