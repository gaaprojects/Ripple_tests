import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { AuditRecord } from "@fx/shared";
import { db } from "./db.js";

/** Deterministic JSON for hashing — sorted keys, no whitespace. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

function hashRecord(prevHash: string, core: Omit<AuditRecord, "hash">): string {
  return createHash("sha256")
    .update(prevHash)
    .update(canonical(core))
    .digest("hex");
}

function lastHash(): string {
  const row = db()
    .prepare("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1")
    .get() as { hash: string } | undefined;
  return row?.hash ?? ""; // "" = genesis
}

export interface AppendAuditArgs {
  intent_id: string | null;
  actor: string; // "system" | "agent" | "human:<id>" | "device"
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Append one tamper-evident audit record (I4). Every state transition and every
 * ledger mutation (before AND after submit) goes through here. No deletes, no updates.
 */
export function appendAudit(args: AppendAuditArgs): AuditRecord {
  const prev_hash = lastHash();
  const core: Omit<AuditRecord, "hash"> = {
    id: ulid(),
    ts: new Date().toISOString(),
    intent_id: args.intent_id,
    actor: args.actor,
    event: args.event,
    payload: args.payload,
    prev_hash,
  };
  const hash = hashRecord(prev_hash, core);
  const rec: AuditRecord = { ...core, hash };
  db()
    .prepare(
      `INSERT INTO audit_log (id, ts, intent_id, actor, event, payload, prev_hash, hash)
       VALUES (@id, @ts, @intent_id, @actor, @event, @payload, @prev_hash, @hash)`,
    )
    .run({ ...rec, payload: JSON.stringify(rec.payload) });
  return rec;
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  brokenAt?: string; // id of first bad record
  reason?: string;
}

/** Recompute the chain end-to-end; any edited/inserted/deleted row breaks it. */
export function verifyChain(): ChainVerification {
  const rows = db()
    .prepare("SELECT * FROM audit_log ORDER BY id ASC")
    .all() as Array<Omit<AuditRecord, "payload"> & { payload: string }>;

  let prev = "";
  for (const row of rows) {
    if (row.prev_hash !== prev) {
      return { ok: false, count: rows.length, brokenAt: row.id, reason: "prev_hash mismatch" };
    }
    const core: Omit<AuditRecord, "hash"> = {
      id: row.id,
      ts: row.ts,
      intent_id: row.intent_id,
      actor: row.actor,
      event: row.event,
      payload: JSON.parse(row.payload),
      prev_hash: row.prev_hash,
    };
    const expected = hashRecord(prev, core);
    if (expected !== row.hash) {
      return { ok: false, count: rows.length, brokenAt: row.id, reason: "hash mismatch" };
    }
    prev = row.hash;
  }
  return { ok: true, count: rows.length };
}

/** Reconstruct the full path for an intent (SPEC §5.13 acceptance). */
export function auditTrail(intentId: string): AuditRecord[] {
  const rows = db()
    .prepare("SELECT * FROM audit_log WHERE intent_id = ? ORDER BY id ASC")
    .all(intentId) as Array<Omit<AuditRecord, "payload"> & { payload: string }>;
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}
