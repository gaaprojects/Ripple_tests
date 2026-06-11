import { z } from "zod";

/**
 * Results of the three parallel pipeline services (SPEC §5.4 / §5.5 / §5.6).
 * Each carries `degraded` so the gate can fail-closed (SPEC §5.3).
 */

// --- Compliance (SPEC §5.4) ---
export const ComplianceResult = z.object({
  sanctioned: z.boolean(),
  credential_found: z.boolean(),
  credential_accepted: z.boolean(),
  sources: z.array(z.string()), // e.g. ["sanctions:2026.06.11-1", "ledger:credential"]
  degraded: z.boolean().default(false),
  checked_at: z.string(),
});
export type ComplianceResult = z.infer<typeof ComplianceResult>;

// --- Risk (SPEC §5.5) ---
export const ShapContribution = z.object({
  feature: z.string(),
  value: z.number(), // the feature's input value
  contribution: z.number(), // SHAP value toward the model output
});
export type ShapContribution = z.infer<typeof ShapContribution>;

export const RiskResult = z.object({
  score: z.number().min(0).max(1),
  model_version: z.string(),
  shap: z.array(ShapContribution),
  base_value: z.number().optional(), // SHAP base; base + sum(contributions) ~= score
  degraded: z.boolean().default(false),
  checked_at: z.string(),
});
export type RiskResult = z.infer<typeof RiskResult>;

// --- Routing (SPEC §5.6) ---
export const RoutePath = z.object({
  // opaque xrpl.js path-set steps; kept as-is for the executor
  steps: z.array(z.record(z.unknown())),
});
export type RoutePath = z.infer<typeof RoutePath>;

export const RouteResult = z.object({
  paths: z.array(RoutePath),
  quoted_cost: z.number(), // source-side cost for the requested delivered amount
  send_max: z.number(), // quoted_cost * (1 + slippage_tolerance) — NEVER partial payment
  slippage_tolerance: z.number(),
  pool_snapshot: z.record(z.unknown()).optional(),
  no_route: z.boolean().default(false),
  degraded: z.boolean().default(false),
  checked_at: z.string(),
});
export type RouteResult = z.infer<typeof RouteResult>;
