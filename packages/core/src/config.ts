import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import { parse as parseYaml } from "yaml";
import { PolicyConfig } from "@fx/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/core/src -> repo root is three levels up
export const REPO_ROOT = resolve(__dirname, "../../..");

dotenv.config({ path: resolve(REPO_ROOT, ".env") });

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name];
}

/** Load + validate the versioned policy thresholds (SPEC §5.7, I3). */
export function loadPolicy(): PolicyConfig {
  const raw = readFileSync(resolve(REPO_ROOT, "ops/config/policy.yaml"), "utf8");
  return PolicyConfig.parse(parseYaml(raw));
}

export const config = {
  wssUrl: env("XRPL_WSS_URL", "wss://s.altnet.rippletest.net:51233"),
  explorerBase: env("XRPL_EXPLORER_BASE", "https://testnet.xrpl.org"),
  apiPort: Number(env("API_HTTP_PORT", "8080")),
  bridgeHttpPort: Number(env("BRIDGE_HTTP_PORT", "8787")),
  riskServiceUrl: env("RISK_SERVICE_URL", "http://127.0.0.1:8000"),
  dbPath: optionalEnv("DB_PATH") ?? resolve(REPO_ROOT, "data/fx-sentinel.sqlite"),
  // Assets (RLUSD issuer verified on-ledger — see ops/provisioning/verify-rlusd.ts)
  rlusdIssuer: env("RLUSD_ISSUER_ADDRESS", "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV"),
  rlusdHex: env("RLUSD_CURRENCY_HEX", "524C555344000000000000000000000000000000"),
  eudCurrency: env("EUD_CURRENCY", "EUD"),
  // DEMO FX rates for normalizing intent amounts to RLUSD-equivalent (SPEC §5.7 input).
  // Static + documented on purpose: the normalization feeding the gate must be deterministic.
  rateEudRlusd: Number(env("RATE_EUD_RLUSD", "1.08")),
  rateXrpRlusd: Number(env("RATE_XRP_RLUSD", "2.00")),
};

export function explorerTxUrl(hash: string): string {
  return `${config.explorerBase}/transactions/${hash}`;
}

export function explorerAccountUrl(addr: string): string {
  return `${config.explorerBase}/accounts/${addr}`;
}
