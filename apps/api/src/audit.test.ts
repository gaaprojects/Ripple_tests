import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

// Build a chain identical to audit.ts but against an in-memory DB, to test the
// hash-chain invariant (I4) without touching the demo SQLite file.
import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

type Rec = {
  id: string;
  ts: string;
  intent_id: string | null;
  actor: string;
  event: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
};

function hashRecord(prev: string, core: Omit<Rec, "hash">): string {
  return createHash("sha256").update(prev).update(canonical(core)).digest("hex");
}

let db: Database.Database;
let seq = 0;
const nextId = () => `id-${String(++seq).padStart(4, "0")}`;

function append(event: string): Rec {
  const prevRow = db.prepare("SELECT hash FROM a ORDER BY id DESC LIMIT 1").get() as
    | { hash: string }
    | undefined;
  const prev_hash = prevRow?.hash ?? "";
  const core: Omit<Rec, "hash"> = {
    id: nextId(),
    ts: "2026-06-11T00:00:00.000Z",
    intent_id: "intent-1",
    actor: "system",
    event,
    payload: { event },
    prev_hash,
  };
  const hash = hashRecord(prev_hash, core);
  db.prepare(
    "INSERT INTO a (id, ts, intent_id, actor, event, payload, prev_hash, hash) VALUES (@id,@ts,@intent_id,@actor,@event,@payload,@prev_hash,@hash)",
  ).run({ ...core, hash, payload: JSON.stringify(core.payload) });
  return { ...core, hash };
}

function verify(): { ok: boolean; brokenAt?: string } {
  const rows = db.prepare("SELECT * FROM a ORDER BY id ASC").all() as Array<
    Omit<Rec, "payload"> & { payload: string }
  >;
  let prev = "";
  for (const row of rows) {
    if (row.prev_hash !== prev) return { ok: false, brokenAt: row.id };
    const core: Omit<Rec, "hash"> = {
      id: row.id,
      ts: row.ts,
      intent_id: row.intent_id,
      actor: row.actor,
      event: row.event,
      payload: JSON.parse(row.payload),
      prev_hash: row.prev_hash,
    };
    if (hashRecord(prev, core) !== row.hash) return { ok: false, brokenAt: row.id };
    prev = row.hash;
  }
  return { ok: true };
}

describe("audit hash chain (I4)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(
      "CREATE TABLE a (id TEXT PRIMARY KEY, ts TEXT, intent_id TEXT, actor TEXT, event TEXT, payload TEXT, prev_hash TEXT, hash TEXT)",
    );
    seq = 0;
  });

  it("verifies an intact chain", () => {
    append("intent.received");
    append("gate.decided");
    append("exec.submitted");
    expect(verify().ok).toBe(true);
  });

  it("detects a tampered payload", () => {
    append("intent.received");
    const target = append("gate.decided");
    append("exec.submitted");
    db.prepare("UPDATE a SET payload = ? WHERE id = ?").run(
      JSON.stringify({ event: "TAMPERED" }),
      target.id,
    );
    const v = verify();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(target.id);
  });

  it("detects a deleted record", () => {
    append("a");
    const mid = append("b");
    append("c");
    db.prepare("DELETE FROM a WHERE id = ?").run(mid.id);
    expect(verify().ok).toBe(false);
  });
});
