import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { appendAudit, verifyChain } from "./audit.js";
import { migrate } from "./db.js";

// Drive the REAL audit.ts (appendAudit / verifyChain / canonical / hashRecord) against an
// isolated in-memory db injected per test (I4, SPEC §5.13). Dependency injection — not the db()
// singleton — so a bug in the hashing logic cannot hide behind a duplicated test copy, and the
// connection is unambiguously the same one used for both append and verify.

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

const append = (event: string, payload: Record<string, unknown> = { event }) =>
  appendAudit({ intent_id: "intent-1", actor: "system", event, payload }, db);

describe("audit hash chain (I4)", () => {
  it("verifies an intact chain", () => {
    append("intent.received");
    append("gate.decided");
    append("exec.submitted");
    expect(verifyChain(db).ok).toBe(true);
  });

  it("detects a tampered payload", () => {
    append("intent.received");
    const target = append("gate.decided");
    append("exec.submitted");
    db.prepare("UPDATE audit_log SET payload = ? WHERE id = ?").run(
      JSON.stringify({ event: "TAMPERED" }),
      target.id,
    );
    const v = verifyChain(db);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(target.id);
  });

  it("detects a deleted record", () => {
    append("a");
    const mid = append("b");
    append("c");
    db.prepare("DELETE FROM audit_log WHERE id = ?").run(mid.id);
    expect(verifyChain(db).ok).toBe(false);
  });

  // Regression: payloads with undefined-valued keys (e.g. an autofilled tx field that is
  // absent) must still verify. JSON.stringify drops such keys when persisting, so canonical()
  // must drop them too — otherwise append-time and verify-time hashes diverge and the chain
  // falsely reports tamper on records nobody touched.
  it("verifies a chain whose payload has undefined-valued keys", () => {
    append("with.undefined", { a: 1, b: undefined, c: { d: undefined, e: "x" } });
    append("after", { ok: true });
    expect(verifyChain(db).ok).toBe(true);
  });

  // Regression: undefined inside an array becomes null under JSON.stringify; canonical() must
  // match so the round-trip is stable.
  it("verifies a chain whose payload array contains undefined", () => {
    append("with.array", { steps: [{ currency: "XRP" }, undefined, 3] });
    expect(verifyChain(db).ok).toBe(true);
  });
});
