/**
 * Demo-funding helper: acquire RLUSD for HOT (and optionally OPS) by converting XRP through the
 * existing public RLUSD/XRP Testnet AMM — a self-payment cross-currency conversion. This avoids
 * the manual RLUSD web faucet and additionally proves XRP→RLUSD routing works.
 *
 * Run: pnpm --filter @fx/provisioning exec tsx acquire-rlusd.ts [seedVar=HOT_SEED] [rlusdAmount=10]
 */
import { ulid } from "ulid";
import { findRoute, executeAuto, appendAudit } from "@fx/core";
import {
  getClient,
  closeClient,
  walletFromEnv,
  RLUSD_ISSUER,
  RLUSD_HEX,
  iou,
} from "./lib.js";

const seedVar = process.argv[2] ?? "HOT_SEED";
const want = process.argv[3] ?? "10";

async function main() {
  await getClient();
  const w = walletFromEnv(seedVar);
  const intentId = ulid();
  const rlusd = iou(RLUSD_HEX, RLUSD_ISSUER, want);

  console.log(`Acquiring ${want} RLUSD for ${seedVar} (${w.address}) via XRP→RLUSD AMM…`);
  const quote = await findRoute({
    source: w.address,
    destination: w.address, // self-conversion
    destinationAmount: rlusd,
    slippageTolerance: 0.02,
    sourceCurrencies: [{ currency: "XRP" }],
  });
  if (quote.result.no_route) {
    console.error("! no XRP→RLUSD route found (is the RLUSD/XRP AMM funded?)");
    await closeClient();
    process.exit(2);
  }
  console.log(`  quote ~${quote.result.quoted_cost} XRP, SendMax ${JSON.stringify(quote.sendMaxAmount)}`);

  appendAudit({ intent_id: intentId, actor: "system", event: "acquire-rlusd.route", payload: quote.result });
  const res = await executeAuto({
    wallet: w,
    destination: w.address,
    deliverAmount: rlusd,
    sendMax: quote.sendMaxAmount,
    paths: quote.paths,
    intentId,
  });
  console.log(`\n✓ acquired RLUSD: ${res.code}\n  ${res.explorer}`);
  await closeClient();
}

main().catch(async (e) => {
  console.error("acquire-rlusd failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
