import { getClient, closeClient, walletFromEnv, RLUSD_ISSUER, RLUSD_HEX, EUD_CURRENCY } from "./lib.js";

async function main() {
  const client = await getClient();
  const hot = walletFromEnv("HOT_SEED");
  const eudIssuer = walletFromEnv("EUD_ISSUER_SEED").address;

  const lines = await client.request({ command: "account_lines", account: hot.address });
  console.log("HOT trustline balances:");
  for (const l of lines.result.lines) console.log(`  ${l.currency} (${l.account}): ${l.balance}`);

  console.log("\nRLUSD/XRP AMM:");
  try {
    const a = await client.request({
      command: "amm_info",
      asset: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER },
      asset2: { currency: "XRP" },
    } as never);
    const amm = (a.result as { amm: { amount: unknown; amount2: unknown } }).amm;
    console.log("  amount:", JSON.stringify(amm.amount), " amount2:", JSON.stringify(amm.amount2));
  } catch (e) {
    console.log("  amm_info error:", (e as Error).message);
  }

  console.log("\nXRP/EUD AMM:");
  try {
    const a = await client.request({
      command: "amm_info",
      asset: { currency: "XRP" },
      asset2: { currency: EUD_CURRENCY, issuer: eudIssuer },
    } as never);
    const amm = (a.result as { amm: { amount: unknown; amount2: unknown } }).amm;
    console.log("  amount:", JSON.stringify(amm.amount), " amount2:", JSON.stringify(amm.amount2));
  } catch (e) {
    console.log("  amm_info error:", (e as Error).message);
  }
  await closeClient();
}
main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1); });
