import { createHash } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { monotonicFactory } from "ulid";
import type { AuditRecord } from "@fx/shared";
import { db } from "./db.js";

type Db = BetterSqlite3.Database;

// Monotonic ULIDs: strictly increasing even within the same millisecond, so ids stay sortable.
// NOTE: chain order is reconstructed by SQLite rowid (true insertion order), NOT by id — the
// hash chain links records in insertion order, and across processes ulid is not guaranteed
// monotonic, whereas rowid is. Ordering by a non-monotonic id would falsely report tamper when
// two records share a millisecond.
const ulid = monotonicFactory();

/**
 * Deterministic JSON for hashing — sorted keys, no whitespace. Must match `JSON.stringify`
 * (used to persist the payload column) exactly, so a hash computed at append time equals the
 * hash recomputed from the stored row at verify time: omit undefined-valued object keys, and
 * render undefined/function array elements as `null`. Otherwise the round-trip drops them and
 * the chain falsely reports tamper (I4).
 */
function canonical(value: unknown): string {
  if (value === undefined || typeof value === "function") return "null"; // only reached for array elements
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && typeof obj[k] !== "function")
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

function hashRecord(prevHash: string, core: Omit<AuditRecord, "hash">): string {
  return createHash("sha256")
    .update(prevHash)
    .update(canonical(core))
    .digest("hex");
}

function lastHash(handle: Db): string {
  const row = handle
    .prepare("SELECT hash FROM audit_log ORDER BY rowid DESC LIMIT 1")
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
export function appendAudit(args: AppendAuditArgs, handle: Db = db()): AuditRecord {
  const prev_hash = lastHash(handle);
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
  handle
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
export function verifyChain(handle: Db = db()): ChainVerification {
  const rows = handle
    .prepare("SELECT * FROM audit_log ORDER BY rowid ASC")
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
export function auditTrail(intentId: string, handle: Db = db()): AuditRecord[] {
  const rows = handle
    .prepare("SELECT * FROM audit_log WHERE intent_id = ? ORDER BY rowid ASC")
    .all(intentId) as Array<Omit<AuditRecord, "payload"> & { payload: string }>;
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}
