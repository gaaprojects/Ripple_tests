import type { AuditRecord, PipelineRecord, QueueItem, TreasuryState } from "@fx/shared";

/** Client-side API access. The api/bridge run on localhost next to the dashboard. */

export const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
export const BRIDGE_WS = process.env.NEXT_PUBLIC_BRIDGE_WS ?? "ws://localhost:8787/ws";

export interface Health {
  ok: boolean;
  network: string;
  policy_version: string;
  amendments: { credentials: { enabled: boolean; checked: boolean } };
  audit_chain: { ok: boolean; count: number; brokenAt?: string; reason?: string };
}

export interface Counterparty {
  label: string;
  address: string;
}
export type Counterparties = Record<"ok" | "fresh" | "sanctioned" | "hot" | "cold", Counterparty>;

export interface DeviceInfo {
  pubkey: string;
  fw_version: string;
  simulated: boolean;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const fetchHealth = () => get<Health>("/health");
export const fetchIntents = () => get<PipelineRecord[]>("/intents");
export const fetchQueue = () => get<QueueItem[]>("/queue");
export const fetchTreasury = () => get<TreasuryState>("/treasury");
export const fetchAudit = () =>
  get<{ chain: Health["audit_chain"]; records: AuditRecord[] }>("/audit");
export const fetchCounterparties = () => get<Counterparties>("/counterparties");

export async function fetchDeviceInfo(): Promise<DeviceInfo | null> {
  try {
    const port = BRIDGE_WS.match(/:(\d+)\//)?.[1] ?? "8787";
    const res = await fetch(`http://localhost:${port}/device/info`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as DeviceInfo) : null;
  } catch {
    return null;
  }
}

export interface CreateIntentBody {
  beneficiary: { name?: string; address: string };
  amount: { value: number; currency: "RLUSD" | "EUD" | "XRP" };
  purpose: string;
  corridor?: string;
}

export async function createIntent(body: CreateIntentBody): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(`${API}/intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => null) };
}

export async function queueAction(id: string, action: "approve" | "reject"): Promise<unknown> {
  const res = await fetch(`${API}/queue/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return res.json().catch(() => null);
}
