import type { IntentStatus, PaymentIntent, PipelineRecord, QueueItem, QueueState } from "@fx/shared";
import { db } from "./db.js";

/** SQLite repositories for intents, pipeline records, and the VETO queue (SPEC §5.13). */

// --- intents ---

export function saveIntent(intent: PaymentIntent): void {
  db()
    .prepare(
      `INSERT INTO intents (id, ts, status, destination, json) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, json = excluded.json`,
    )
    .run(intent.id, intent.created_at, intent.status, intent.beneficiary.address, JSON.stringify(intent));
}

export function updateIntentStatus(id: string, status: IntentStatus): void {
  const row = db().prepare("SELECT json FROM intents WHERE id = ?").get(id) as
    | { json: string }
    | undefined;
  if (!row) return;
  const intent = JSON.parse(row.json) as PaymentIntent;
  intent.status = status;
  db()
    .prepare("UPDATE intents SET status = ?, json = ? WHERE id = ?")
    .run(status, JSON.stringify(intent), id);
}

export function getIntent(id: string): PaymentIntent | null {
  const row = db().prepare("SELECT json FROM intents WHERE id = ?").get(id) as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as PaymentIntent) : null;
}

export function listIntents(limit = 100): PaymentIntent[] {
  const rows = db()
    .prepare("SELECT json FROM intents ORDER BY rowid DESC LIMIT ?")
    .all(limit) as Array<{ json: string }>;
  return rows.map((r) => JSON.parse(r.json) as PaymentIntent);
}

/** Risk features (SPEC §5.5): prior intents to this destination, excluding the given one. */
export function isNewCounterparty(destination: string, excludeIntentId: string): boolean {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM intents WHERE destination = ? AND id != ?")
    .get(destination, excludeIntentId) as { n: number };
  return row.n === 0;
}

export function intentVelocity(excludeIntentId: string, windowMs: number): number {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM intents WHERE ts >= ? AND id != ?")
    .get(since, excludeIntentId) as { n: number };
  return row.n;
}

// --- pipeline records ---

export function savePipelineRecord(rec: PipelineRecord): void {
  db()
    .prepare(
      `INSERT INTO pipeline_records (intent_id, ts, json) VALUES (?, ?, ?)
       ON CONFLICT(intent_id) DO UPDATE SET json = excluded.json`,
    )
    .run(rec.intent.id, new Date().toISOString(), JSON.stringify(rec));
}

export function getPipelineRecord(intentId: string): PipelineRecord | null {
  const row = db().prepare("SELECT json FROM pipeline_records WHERE intent_id = ?").get(intentId) as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as PipelineRecord) : null;
}

export function listPipelineRecords(limit = 100): PipelineRecord[] {
  const rows = db()
    .prepare("SELECT json FROM pipeline_records ORDER BY rowid DESC LIMIT ?")
    .all(limit) as Array<{ json: string }>;
  return rows.map((r) => JSON.parse(r.json) as PipelineRecord);
}

// --- VETO queue ---

export function saveQueueItem(item: QueueItem): void {
  db()
    .prepare(
      `INSERT INTO queue_items (intent_id, ts, state, json) VALUES (?, ?, ?, ?)
       ON CONFLICT(intent_id) DO UPDATE SET state = excluded.state, json = excluded.json`,
    )
    .run(item.intent_id, new Date().toISOString(), item.state, JSON.stringify(item));
}

export function getQueueItem(intentId: string): QueueItem | null {
  const row = db().prepare("SELECT json FROM queue_items WHERE intent_id = ?").get(intentId) as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as QueueItem) : null;
}

export function listQueueItems(states?: QueueState[]): QueueItem[] {
  const rows = (
    states?.length
      ? db()
          .prepare(
            `SELECT json FROM queue_items WHERE state IN (${states.map(() => "?").join(",")})
             ORDER BY rowid DESC`,
          )
          .all(...states)
      : db().prepare("SELECT json FROM queue_items ORDER BY rowid DESC").all()
  ) as Array<{ json: string }>;
  return rows.map((r) => JSON.parse(r.json) as QueueItem);
}

/** Append a state transition + persist (states per SPEC §5.9). */
export function transitionQueueItem(item: QueueItem, state: QueueState, note?: string): QueueItem {
  const next: QueueItem = {
    ...item,
    state,
    transitions: [...item.transitions, { state, at: new Date().toISOString(), note }],
  };
  saveQueueItem(next);
  return next;
}
