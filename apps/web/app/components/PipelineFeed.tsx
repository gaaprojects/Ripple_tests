"use client";

import type { PipelineRecord } from "@fx/shared";

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-5)}` : a;
}

function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

export function PipelineFeed({ records }: { records: PipelineRecord[] }) {
  if (!records.length) {
    return <div className="empty">NO INTENTS YET — SUBMIT ONE OR FIRE A PRESET</div>;
  }
  return (
    <div>
      {records.map((r) => {
        const o = r.decision.outcome;
        const status = r.intent.status;
        return (
          <div key={r.intent.id} className={`feed-row ${o}`}>
            <div>
              <span className={`chip ${o}`}>{o}</span>
              <div className="status-line" style={{ marginTop: 4 }}>
                <span className={`status-line ${status}`}>{status}</span>
              </div>
            </div>
            <div className="feed-main">
              <div className="dest">
                {r.intent.beneficiary.name || shortAddr(r.intent.beneficiary.address)}
                {r.intent.purpose ? <span style={{ color: "var(--ink-dim)" }}> · {r.intent.purpose}</span> : null}
              </div>
              <div className="meta">
                {timeOf(r.intent.created_at)} · rule <span className="rule">{r.decision.matched_rule}</span> · risk{" "}
                {r.risk.degraded ? "DEGRADED" : r.risk.score.toFixed(2)} · cred{" "}
                {r.compliance.degraded ? "DEGRADED" : r.compliance.credential_accepted ? "OK" : "—"} ·{" "}
                {r.route.no_route ? "NO ROUTE" : `route ${r.route.quoted_cost.toFixed(2)}`}
                {" · "}
                {r.tx_hash && r.explorer_url ? (
                  <a className="txlink" href={r.explorer_url} target="_blank" rel="noreferrer">
                    {r.tx_hash.slice(0, 12)}… ↗
                  </a>
                ) : r.exec_error ? (
                  <span style={{ color: "var(--block)" }}>exec: {r.exec_error.slice(0, 60)}</span>
                ) : (
                  <span style={{ color: "var(--ink-faint)" }}>hash {r.decision.input_hash.slice(0, 10)}…</span>
                )}
              </div>
            </div>
            <div className="amount">
              {r.intent.amount.value}
              <span className="ccy">{r.intent.amount.currency}</span>
              <div className="status-line">{r.amount_rlusd_eq.toFixed(2)} RLUSD-eq</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
