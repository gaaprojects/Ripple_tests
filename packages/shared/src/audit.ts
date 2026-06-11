import { z } from "zod";

/** Audit record (SPEC §5.13). Append-only, hash-chained (I4). */
export const AuditActor = z.string(); // "system" | "agent" | "human:<id>" | "device"

export const AuditRecord = z.object({
  id: z.string(), // ulid (monotonic — also gives ordering)
  ts: z.string(), // ISO-8601
  intent_id: z.string().nullable(),
  actor: AuditActor,
  event: z.string(), // e.g. "intent.received", "gate.decided", "exec.submitted"
  payload: z.record(z.unknown()), // snapshot
  prev_hash: z.string(), // hash of the previous record ("" for genesis)
  hash: z.string(), // sha256(prev_hash + canonical(record-without-hash))
});
export type AuditRecord = z.infer<typeof AuditRecord>;
