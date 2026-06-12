"use client";

import type { TreasuryState } from "@fx/shared";

export function TreasuryPanel({ treasury }: { treasury: TreasuryState | null }) {
  if (!treasury) return <div className="empty">LOADING TREASURY…</div>;
  const pct = treasury.float_cap_rlusd
    ? Math.min(100, (treasury.float_headroom_rlusd / treasury.float_cap_rlusd) * 100)
    : 0;
  return (
    <div>
      <table className="bal-table">
        <tbody>
          <tr>
            <td className="lbl">HOT · XRP</td>
            <td>{treasury.hot_xrp.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="lbl">HOT · RLUSD</td>
            <td>{treasury.hot_rlusd.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="lbl">HOT · EUD</td>
            <td>{treasury.hot_eud.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="lbl">COLD · XRP</td>
            <td>{treasury.cold_xrp.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="lbl">COLD · RLUSD</td>
            <td>{treasury.cold_rlusd.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <div className="gauge-wrap">
        <div className="gauge-label">
          <span>Float headroom (I5)</span>
          <span>
            {treasury.float_headroom_rlusd.toFixed(2)} / {treasury.float_cap_rlusd} RLUSD
          </span>
        </div>
        <div className={`gauge ${pct < 30 ? "warn" : ""}`}>
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="addr">HOT {treasury.hot_address}</div>
        <div className="addr">COLD {treasury.cold_address} · key on device only</div>
      </div>
    </div>
  );
}
