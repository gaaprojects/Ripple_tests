/**
 * P1 smoke test (SPEC §5.6 + §5.8): one hardcoded RLUSD→EUD AUTO payment from HOT_ACCOUNT to
 * COUNTERPARTY_OK, routed via path_find through the two seeded AMMs (RLUSD/XRP, XRP/EUD), with
 * exact delivery and bounded SendMax — no partial payments. Settles tesSUCCESS, explorer-visible.
 *
 * Prereqs: accounts funded, trustlines set, EUD minted, BOTH AMMs live, HOT holds RLUSD.
 * Run: pnpm --filter @fx/provisioning exec tsx smoke-payment.ts
 */
import { ulid } from "ulid";
import { findRoute, executeAuto, appendAudit } from "@fx/core";
import {
  getClient,
  closeClient,
  walletFromEnv,
  requireEnv,
  RLUSD_ISSUER,
  RLUSD_HEX,
  EUD_CURRENCY,
  iou,
} from "./lib.js";

const DELIVER_EUD = "1"; // demo: deliver 1 EUD

async function main() {
  await getClient();
  const hot = walletFromEnv("HOT_SEED");
  const eudIssuer = walletFromEnv("EUD_ISSUER_SEED").address;
  const destination = requireEnv("COUNTERPARTY_OK_ADDRESS");
  const intentId = ulid();

  appendAudit({
    intent_id: intentId,
    actor: "system",
    event: "intent.smoke.received",
    payload: { source: hot.address, destination, deliver: `${DELIVER_EUD} EUD` },
  });

  const deliverAmount = iou(EUD_CURRENCY, eudIssuer, DELIVER_EUD);

  // Force RLUSD as the funding asset so we exercise the intended RLUSD→XRP→EUD route (HOT also
  // holds XRP, which path_find would otherwise prefer). Small Testnet AMMs + two 0.5%-fee hops
  // move price more than mainnet pools, so the demo uses a wider slippage buffer.
  console.log(`Routing RLUSD→EUD: deliver ${DELIVER_EUD} EUD to ${destination}…`);
  const quote = await findRoute({
    source: hot.address,
    destination,
    destinationAmount: deliverAmount,
    slippageTolerance: 0.05,
    sourceCurrencies: [{ currency: RLUSD_HEX, issuer: RLUSD_ISSUER }],
    bridgeVia: { currency: "XRP" }, // legacy path_find won't synthesize RLUSD→XRP→EUD; quote it as 2 legs
  });
  appendAudit({ intent_id: intentId, actor: "system", event: "route.smoke", payload: quote.result });

  if (quote.result.no_route) {
    console.error(
      "! no_route — ensure BOTH AMMs exist and HOT holds RLUSD. Gate would force VETO here (SPEC §5.6).",
    );
    await closeClient();
    process.exit(2);
  }

  console.log(
    `  source ${quote.result.pool_snapshot?.source_currency}: quote ${quote.result.quoted_cost}` +
      `  send_max ${JSON.stringify(quote.sendMaxAmount)}`,
  );

  console.log("Executing AUTO payment from HOT…");
  const result = await executeAuto({
    wallet: hot,
    destination,
    deliverAmount,
    sendMax: quote.sendMaxAmount,
    paths: quote.paths,
    intentId,
  });

  console.log(`\n✓ AUTO settled: ${result.code}\n  ${result.explorer}`);
  await closeClient();
}

main().catch(async (e) => {
  console.error("smoke-payment failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
