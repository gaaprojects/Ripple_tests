"use client";

import { useState } from "react";
import type { PipelineRecord, QueueItem } from "@fx/shared";
import { queueAction } from "../lib/api";
import { ShapBars } from "./ShapBars";

/**
 * VETO approval queue (SPEC §5.14): intent context, SHAP bars, route quote, narrative,
 * Approve/Reject, and the Ledger-style live device state while awaiting confirmation.
 */
export function ApprovalQueue({
  queue,
  records,
  deviceLive,
  onAction,
}: {
  queue: QueueItem[];
  records: PipelineRecord[];
  deviceLive: string | null;
  onAction: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    await queueAction(id, action);
    setBusyId(null);
    onAction();
  };

  const active = queue.filter((q) => q.state === "pending" || q.state === "awaiting_device" || q.state === "signed");
  const terminal = queue.filter((q) => !active.includes(q)).slice(0, 6);

  if (!queue.length) return <div className="empty">QUEUE EMPTY — VETO INTENTS LAND HERE</div>;

  const render = (item: QueueItem, isTerminal: boolean) => {
    const rec = records.find((r) => r.intent.id === item.intent_id);
    const busy = busyId === item.intent_id;
    return (
      <div key={item.intent_id} className={`queue-card ${isTerminal ? "terminal" : ""}`}>
        <div className="qc-head">
          <span className="amount" style={{ fontSize: 13 }}>
            {rec ? `${rec.intent.amount.value} ${rec.intent.amount.currency}` : item.intent_id.slice(0, 10)}
            {rec?.intent.beneficiary.name ? (
              <span style={{ color: "var(--ink-dim)", fontWeight: 400 }}> → {rec.intent.beneficiary.name}</span>
            ) : null}
          </span>
          <span className={`qstate ${item.state}`}>{item.state.replace("_", " ")}</span>
        </div>
        <div className="qc-body">
          {item.state === "awaiting_device" && (
            <div className="device-confirm">{deviceLive ?? "CONFIRM ON DEVICE…"}</div>
          )}
          {rec && rec.risk.shap.length > 0 && <ShapBars shap={rec.risk.shap} score={rec.risk.score} />}
          {item.narrative && <div className="narrative">{item.narrative}</div>}
          {item.tx_hash && item.explorer_url && (
            <a className="txlink" href={item.explorer_url} target="_blank" rel="noreferrer">
              settled · {item.tx_hash.slice(0, 16)}… ↗
            </a>
          )}
          {item.state === "pending" && (
            <div className="qc-actions">
              <button className="btn btn-approve" disabled={busy} onClick={() => void act(item.intent_id, "approve")}>
                {busy ? "Signing…" : "Approve → device"}
              </button>
              <button className="btn btn-reject" disabled={busy} onClick={() => void act(item.intent_id, "reject")}>
                Reject
              </button>
            </div>
          )}
          <div className="status-line">
            {item.transitions.map((t) => `${t.state}@${t.at.slice(11, 19)}`).join(" → ")}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {active.map((q) => render(q, false))}
      {terminal.map((q) => render(q, true))}
    </div>
  );
}
