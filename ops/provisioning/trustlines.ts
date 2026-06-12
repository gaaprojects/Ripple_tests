/**
 * Set trustlines and issuer flags (SPEC §5.1):
 *  - DefaultRipple on EUD_ISSUER and COMPLIANCE_ISSUER (so issued IOUs can ripple)
 *  - RLUSD trustline from HOT / OPS / counterparties to the verified RLUSD issuer
 *  - EUD trustline from HOT / OPS / counterparties to EUD_ISSUER
 *
 * Run: pnpm --filter @fx/provisioning exec tsx trustlines.ts
 */
import type { AccountSet, TrustSet } from "xrpl";
import {
  getClient,
  closeClient,
  walletFromEnv,
  requireEnv,
  submitAudited,
  RLUSD_ISSUER,
  RLUSD_HEX,
  EUD_CURRENCY,
} from "./lib.js";

const ASF_DEFAULT_RIPPLE = 8;
const TRUST_LIMIT = "1000000000"; // generous demo limit

async function enableDefaultRipple(seedVar: string): Promise<void> {
  const w = walletFromEnv(seedVar);
  const tx: AccountSet = {
    TransactionType: "AccountSet",
    Account: w.address,
    SetFlag: ASF_DEFAULT_RIPPLE,
  };
  await submitAudited(`defaultRipple.${seedVar}`, w, tx);
}

async function trust(
  holderSeedVar: string,
  currency: string,
  issuer: string,
): Promise<void> {
  const w = walletFromEnv(holderSeedVar);
  const tx: TrustSet = {
    TransactionType: "TrustSet",
    Account: w.address,
    LimitAmount: { currency, issuer, value: TRUST_LIMIT },
  };
  await submitAudited(`trust.${holderSeedVar}.${currency.slice(0, 6)}`, w, tx);
}

async function main() {
  await getClient();
  const eudIssuer = walletFromEnv("EUD_ISSUER_SEED").address;

  console.log("Enabling DefaultRipple on issuers…");
  await enableDefaultRipple("EUD_ISSUER_SEED");
  await enableDefaultRipple("COMPLIANCE_ISSUER_SEED");

  // Holders that need RLUSD + EUD trustlines. Counterparties hold EUD (payment destinations).
  console.log("Setting RLUSD trustlines…");
  for (const v of ["HOT_SEED", "OPS_SEED", "COUNTERPARTY_OK_SEED", "COUNTERPARTY_NEW_SEED"]) {
    if (!process.env[v]) {
      console.log(`  • ${v} not set — skipping`);
      continue;
    }
    await trust(v, RLUSD_HEX, RLUSD_ISSUER);
  }

  console.log("Setting EUD trustlines…");
  for (const v of ["HOT_SEED", "OPS_SEED", "COUNTERPARTY_OK_SEED", "COUNTERPARTY_NEW_SEED"]) {
    if (!process.env[v]) {
      console.log(`  • ${v} not set — skipping`);
      continue;
    }
    await trust(v, EUD_CURRENCY, eudIssuer);
  }

  void requireEnv("RLUSD_ISSUER_ADDRESS");
  console.log("Trustlines done.");
  await closeClient();
}

main().catch(async (e) => {
  console.error("trustlines failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
