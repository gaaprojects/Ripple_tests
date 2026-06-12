import { Wallet } from "xrpl";
import { env } from "./config.js";

/**
 * Server-held wallets (SPEC §7). HOT signs AUTO payments; issuer addresses are derived from
 * their seeds. COLD_TREASURY is ADDRESS ONLY (I2) — its RegularKey lives on the device.
 */
export function hotWallet(): Wallet {
  return Wallet.fromSeed(env("HOT_SEED"));
}

export function eudIssuerAddress(): string {
  return Wallet.fromSeed(env("EUD_ISSUER_SEED")).address;
}

export function complianceIssuerAddress(): string {
  return Wallet.fromSeed(env("COMPLIANCE_ISSUER_SEED")).address;
}

export function coldTreasuryAddress(): string {
  return env("COLD_TREASURY_ADDRESS");
}
