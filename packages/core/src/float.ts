import { ulid } from "ulid";
import { db } from "./db.js";

/**
 * Hot-account float ledger (SPEC §5.13, I5). Spends are negative deltas, refills positive.
 * Headroom = cap - used; the Policy Gate refuses AUTO above headroom, and the pipeline
 * asserts again right before execution (belt and braces).
 */
export function floatUsedRlusd(): number {
  const row = db()
    .prepare("SELECT COALESCE(SUM(delta_rlusd), 0) AS total FROM float_ledger")
    .get() as { total: number };
  // total is net (refills - spends); used = -total, never below zero.
  return Math.max(0, -row.total);
}

export function floatHeadroomRlusd(capRlusd: number): number {
  return Math.max(0, capRlusd - floatUsedRlusd());
}

function record(intentId: string | null, delta: number, note: string): void {
  db()
    .prepare(
      `INSERT INTO float_ledger (id, ts, intent_id, delta_rlusd, note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ulid(), new Date().toISOString(), intentId, delta, note);
}

export function recordFloatSpend(intentId: string, amountRlusd: number, note = "auto spend"): void {
  record(intentId, -Math.abs(amountRlusd), note);
}

export function recordFloatRefill(intentId: string | null, amountRlusd: number, note = "refill"): void {
  record(intentId, Math.abs(amountRlusd), note);
}
