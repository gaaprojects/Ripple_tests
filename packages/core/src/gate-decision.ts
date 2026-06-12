import { createHash } from "node:crypto";
import type { GateDecision, GateInput } from "@fx/shared";
import { canonicalJson } from "./audit.js";
import { evaluateGate } from "./gate.js";

/**
 * Wrap the pure gate with the input-snapshot hash (SPEC §5.7: replayability IS the audit
 * story). Hashing is deterministic, but lives here so gate.ts itself imports nothing.
 */
export function hashGateInput(input: GateInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function decideGate(input: GateInput): GateDecision {
  const e = evaluateGate(input);
  return { ...e, input_hash: hashGateInput(input) };
}
