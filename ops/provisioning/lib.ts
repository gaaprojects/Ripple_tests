/**
 * Shared provisioning helpers (SPEC §5.1). One-time setup CLIs grown from the team baseline
 * fund-wallet.js / send-payment.js. Ledger mutations go through @fx/core submitAudited (audited
 * before AND after submit — SPEC §0.3 rule 4). Uses the single shared @fx/core XRPL client.
 */
import { Wallet } from "xrpl";
import {
  xrplClient,
  disconnectXrpl,
  explorerTxUrl,
  explorerAccountUrl,
  submitAudited,
  REPO_ROOT,
} from "@fx/core";

// Asset constants — RLUSD verified on-ledger (see verify-rlusd.ts, memory: rlusd-testnet-issuer).
export const RLUSD_ISSUER = process.env.RLUSD_ISSUER_ADDRESS ?? "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
export const RLUSD_HEX =
  process.env.RLUSD_CURRENCY_HEX ?? "524C555344000000000000000000000000000000";
export const EUD_CURRENCY = process.env.EUD_CURRENCY ?? "EUD";

export { submitAudited, REPO_ROOT };
export const getClient = xrplClient;
export const closeClient = disconnectXrpl;
export const explorerTx = explorerTxUrl;
export const explorerAccount = explorerAccountUrl;

/** Named server wallets loaded from .env seeds. COLD_TREASURY is address-only (never a seed). */
export function walletFromEnv(seedVar: string): Wallet {
  const seed = process.env[seedVar];
  if (!seed) throw new Error(`Missing seed env var: ${seedVar}`);
  return Wallet.fromSeed(seed);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Trustline currency-amount helper for IOUs. */
export function iou(currency: string, issuer: string, value: string) {
  return { currency, issuer, value };
}
