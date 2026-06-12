import { EventEmitter } from "node:events";

/**
 * In-process event bus feeding the dashboard's live SSE stream. Display-only plumbing —
 * no business logic subscribes to it (the pipeline is synchronous and deterministic).
 */
export interface FxEvent {
  type:
    | "intent.received"
    | "pipeline.services"
    | "gate.decided"
    | "exec.settled"
    | "exec.failed"
    | "queue.enqueued"
    | "queue.updated"
    | "intent.blocked";
  intent_id?: string;
  data?: unknown;
  ts: string;
}

export const fxBus = new EventEmitter();
fxBus.setMaxListeners(50);

export function emitFx(type: FxEvent["type"], intent_id?: string, data?: unknown): void {
  const ev: FxEvent = { type, intent_id, data, ts: new Date().toISOString() };
  fxBus.emit("fx", ev);
}
