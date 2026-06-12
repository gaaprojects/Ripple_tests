"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditRecord, PipelineRecord, QueueItem, TreasuryState } from "@fx/shared";
import {
  API,
  BRIDGE_WS,
  fetchAudit,
  fetchCounterparties,
  fetchDeviceInfo,
  fetchHealth,
  fetchIntents,
  fetchQueue,
  fetchTreasury,
  type Counterparties,
  type DeviceInfo,
  type Health,
} from "../lib/api";
import { TopBar } from "./TopBar";
import { IntentForm } from "./IntentForm";
import { TreasuryPanel } from "./TreasuryPanel";
import { PipelineFeed } from "./PipelineFeed";
import { ApprovalQueue } from "./ApprovalQueue";
import { AuditExplorer } from "./AuditExplorer";

const POLL_MS = 3000;

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [records, setRecords] = useState<PipelineRecord[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [treasury, setTreasury] = useState<TreasuryState | null>(null);
  const [audit, setAudit] = useState<{ chain: Health["audit_chain"]; records: AuditRecord[] } | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [counterparties, setCounterparties] = useState<Counterparties | null>(null);
  const [deviceLive, setDeviceLive] = useState<string | null>(null); // bridge WS state line
  const [apiDown, setApiDown] = useState(false);

  const refresh = useCallback(async () => {
    const [h, i, q, t, a] = await Promise.all([
      fetchHealth(),
      fetchIntents(),
      fetchQueue(),
      fetchTreasury(),
      fetchAudit(),
    ]);
    setApiDown(h === null);
    if (h) setHealth(h);
    if (i) setRecords(i);
    if (q) setQueue(q);
    if (t) setTreasury(t);
    if (a) setAudit(a);
  }, []);

  // boot + poll
  useEffect(() => {
    void refresh();
    void fetchDeviceInfo().then(setDevice);
    void fetchCounterparties().then(setCounterparties);
    const id = setInterval(() => void refresh(), POLL_MS);
    const did = setInterval(() => void fetchDeviceInfo().then(setDevice), 10_000);
    return () => {
      clearInterval(id);
      clearInterval(did);
    };
  }, [refresh]);

  // API SSE: instant refresh on pipeline events
  useEffect(() => {
    const es = new EventSource(`${API}/events`);
    es.onmessage = () => void refresh();
    es.onerror = () => {
      /* poll covers it */
    };
    return () => es.close();
  }, [refresh]);

  // Bridge WS: live device-confirmation state (< 1 s per SPEC §5.14)
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    let closed = false;
    const connect = () => {
      try {
        const ws = new WebSocket(BRIDGE_WS);
        wsRef.current = ws;
        ws.onmessage = (m) => {
          try {
            const ev = JSON.parse(m.data as string) as { event: string };
            if (ev.event === "awaiting_confirmation") setDeviceLive("CONFIRM ON DEVICE…");
            else if (ev.event === "approved") setDeviceLive("APPROVED ON DEVICE");
            else if (ev.event === "rejected") setDeviceLive("REJECTED ON DEVICE");
            else if (ev.event === "timeout") setDeviceLive("DEVICE TIMEOUT");
            if (ev.event !== "awaiting_confirmation") setTimeout(() => setDeviceLive(null), 4000);
          } catch {
            /* ignore malformed */
          }
        };
        ws.onclose = () => {
          if (!closed) setTimeout(connect, 3000);
        };
      } catch {
        setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  return (
    <main className="console">
      <TopBar health={health} treasury={treasury} device={device} apiDown={apiDown} />

      <section className="panel panel-left">
        <div className="panel-head">New payment intent</div>
        <div className="panel-body">
          <IntentForm counterparties={counterparties} onSubmitted={refresh} />
        </div>
        <div className="panel-head">Treasury</div>
        <div className="panel-body" style={{ flex: "0 0 auto" }}>
          <TreasuryPanel treasury={treasury} />
        </div>
      </section>

      <section className="panel panel-feed">
        <div className="panel-head">
          Pipeline feed
          <span className="count">{records.length} intents</span>
        </div>
        <div className="panel-body">
          <PipelineFeed records={records} />
        </div>
      </section>

      <section className="panel panel-queue">
        <div className="panel-head">
          Approval queue · VETO
          <span className="count">{queue.filter((q) => q.state === "pending").length} pending</span>
        </div>
        <div className="panel-body">
          <ApprovalQueue queue={queue} records={records} deviceLive={deviceLive} onAction={refresh} />
        </div>
      </section>

      <section className="panel panel-audit">
        <div className="panel-head">
          Audit explorer · hash chain
          {audit && (
            <span className={audit.chain.ok ? "chain-ok" : "chain-bad"}>
              {audit.chain.ok
                ? `CHAIN INTACT · ${audit.chain.count} records`
                : `CHAIN BROKEN @ ${audit.chain.brokenAt} (${audit.chain.reason})`}
            </span>
          )}
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          <AuditExplorer records={audit?.records ?? []} />
        </div>
      </section>
    </main>
  );
}
