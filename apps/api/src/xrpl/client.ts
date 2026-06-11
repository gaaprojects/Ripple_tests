import { Client } from "xrpl";
import { config } from "../config.js";

let _client: Client | null = null;

/** Shared, lazily-connected Testnet client. */
export async function xrplClient(): Promise<Client> {
  if (_client && _client.isConnected()) return _client;
  const c = new Client(config.wssUrl);
  await c.connect();
  _client = c;
  return c;
}

export async function disconnectXrpl(): Promise<void> {
  if (_client?.isConnected()) await _client.disconnect();
  _client = null;
}

export interface AmendmentStatus {
  name: string;
  enabled: boolean;
}

/**
 * Boot check (SPEC §5.1, D1): is the given amendment enabled on this network?
 * Used to degrade the compliance/credential story if XLS-70 is absent on Testnet.
 */
export async function amendmentEnabled(name: string): Promise<AmendmentStatus> {
  const c = await xrplClient();
  // `feature` with no id returns the full amendment table.
  const res = (await c.request({ command: "feature" } as never)) as {
    result: { features?: Record<string, { name?: string; enabled?: boolean }> };
  };
  const features = res.result.features ?? {};
  for (const f of Object.values(features)) {
    if (f.name === name) return { name, enabled: Boolean(f.enabled) };
  }
  return { name, enabled: false };
}
