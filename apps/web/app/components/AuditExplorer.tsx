"use client";

import type { AuditRecord } from "@fx/shared";

export function AuditExplorer({ records }: { records: AuditRecord[] }) {
  if (!records.length) return <div className="empty">AUDIT LOG EMPTY</div>;
  return (
    <table className="audit-table">
      <thead>
        <tr>
          <th>TS (UTC)</th>
          <th>Event</th>
          <th>Intent</th>
          <th>Actor</th>
          <th>Hash</th>
          <th>Prev</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id}>
            <td>{r.ts.slice(11, 19)}</td>
            <td className="event">{r.event}</td>
            <td>{r.intent_id ? `${r.intent_id.slice(0, 10)}…` : "—"}</td>
            <td>{r.actor}</td>
            <td className="hash">{r.hash.slice(0, 12)}…</td>
            <td className="hash">{r.prev_hash ? `${r.prev_hash.slice(0, 12)}…` : "genesis"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
