"use client";

import type { TreasuryState } from "@fx/shared";
import type { DeviceInfo, Health } from "../lib/api";

export function TopBar({
  health,
  treasury,
  device,
  apiDown,
}: {
  health: Health | null;
  treasury: TreasuryState | null;
  device: DeviceInfo | null;
  apiDown: boolean;
}) {
  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="tick" />
        FX-SENTINEL
        <span className="sub">TREASURY OPS · XRPL TESTNET</span>
      </div>
      <div className="topstats">
        <div className="topstat">
          <span className="k">API</span>
          <span className={`v ${apiDown ? "bad" : "good"}`}>{apiDown ? "OFFLINE" : "LIVE"}</span>
        </div>
        <div className="topstat">
          <span className="k">Policy</span>
          <span className="v">{health?.policy_version ?? "—"}</span>
        </div>
        <div className="topstat">
          <span className="k">XLS-70 Credentials</span>
          <span className={`v ${health?.amendments.credentials.enabled ? "good" : "bad"}`}>
            {health ? (health.amendments.credentials.enabled ? "ENABLED" : "ABSENT") : "—"}
          </span>
        </div>
        <div className="topstat">
          <span className="k">Audit chain</span>
          <span className={`v ${health?.audit_chain.ok ? "good" : "bad"}`}>
            {health ? (health.audit_chain.ok ? `INTACT · ${health.audit_chain.count}` : "BROKEN") : "—"}
          </span>
        </div>
        <div className="topstat">
          <span className="k">Hot float headroom</span>
          <span className="v">
            {treasury ? `${treasury.float_headroom_rlusd.toFixed(2)} / ${treasury.float_cap_rlusd} RLUSD` : "—"}
          </span>
        </div>
        <div className="topstat">
          <span className="k">Device</span>
          <span className="v">{device ? `${device.fw_version} · ${device.pubkey.slice(0, 10)}…` : "BRIDGE DOWN"}</span>
        </div>
      </div>
      {device?.simulated === true && <div className="sim-badge">⚠ SIMULATED DEVICE</div>}
      {device?.simulated === false && <div className="hw-badge">● HARDWARE KEY</div>}
    </header>
  );
}
