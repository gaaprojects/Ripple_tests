/**
 * Mint EUD (demo EUR IOU) from EUD_ISSUER to OPS and counterparties (SPEC §5.1, D4).
 * Minting an IOU = the issuer sends a Payment of that currency to a holder with a trustline.
 *
 * Run: pnpm --filter @fx/provisioning exec tsx mint-eud.ts
 */
import type { Payment } from "xrpl";
import {
  getClient,
  closeClient,
  walletFromEnv,
  submitAudited,
  EUD_CURRENCY,
  iou,
} from "./lib.js";

const MINT_TO: Array<{ seedVar: string; value: string }> = [
  { seedVar: "OPS_SEED", value: "100000" }, // OPS seeds the XRP/EUD AMM + holds float
  { seedVar: "COUNTERPARTY_OK_SEED", value: "10" },
  { seedVar: "COUNTERPARTY_NEW_SEED", value: "10" },
];

async function main() {
  await getClient();
  const issuer = walletFromEnv("EUD_ISSUER_SEED");

  for (const { seedVar, value } of MINT_TO) {
    if (!process.env[seedVar]) {
      console.log(`  • ${seedVar} not set — skipping`);
      continue;
    }
    const holder = walletFromEnv(seedVar).address;
    const tx: Payment = {
      TransactionType: "Payment",
      Account: issuer.address,
      Destination: holder,
      Amount: iou(EUD_CURRENCY, issuer.address, value),
    };
    await submitAudited(`mintEUD.${seedVar}`, issuer, tx);
  }

  console.log("EUD minting done.");
  await closeClient();
}

main().catch(async (e) => {
  console.error("mint-eud failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
