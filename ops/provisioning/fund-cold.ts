/**
 * Give COLD_TREASURY the holdings the VETO path spends (SPEC §5.9: VETO payments are built
 * FROM COLD_TREASURY): an RLUSD trustline + a starting RLUSD balance acquired by converting
 * COLD's own faucet XRP through the public RLUSD/XRP AMM (self-payment).
 *
 * Signing: uses the cold MASTER seed from the gitignored .provision-secrets.json — this is a
 * one-time provisioning step like set-regular-key.ts. The runtime (I2) never sees this seed;
 * after provisioning, COLD transactions are signed only by the device RegularKey.
 *
 * Run: pnpm --filter @fx/provisioning exec tsx fund-cold.ts [rlusdAmount=300]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wallet, type TrustSet } from "xrpl";
import { ulid } from "ulid";
import { findRoute, executeAuto, appendAudit, REPO_ROOT } from "@fx/core";
import { getClient, closeClient, submitAudited, RLUSD_ISSUER, RLUSD_HEX, iou } from "./lib.js";

const want = process.argv[2] ?? "300";
const SECRETS = resolve(REPO_ROOT, "ops/provisioning/.provision-secrets.json");

function coldMasterWallet(): Wallet {
  if (!existsSync(SECRETS)) {
    throw new Error("Missing .provision-secrets.json — run fund-accounts.ts first.");
  }
  const seed = JSON.parse(readFileSync(SECRETS, "utf8")).COLD_TREASURY_SEED as string;
  if (!seed) throw new Error("COLD_TREASURY_SEED missing from secrets file");
  return Wallet.fromSeed(seed);
}

async function hasRlusdLine(address: string): Promise<{ line: boolean; balance: number }> {
  const client = await getClient();
  const res = await client.request({ command: "account_lines", account: address, peer: RLUSD_ISSUER });
  const line = res.result.lines.find((l) => l.currency === RLUSD_HEX);
  return { line: Boolean(line), balance: line ? Number(line.balance) : 0 };
}

async function main() {
  await getClient();
  const cold = coldMasterWallet();
  console.log(`COLD_TREASURY ${cold.address}: provisioning RLUSD holdings…`);

  const { line, balance } = await hasRlusdLine(cold.address);
  if (!line) {
    const trust: TrustSet = {
      TransactionType: "TrustSet",
      Account: cold.address,
      LimitAmount: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "1000000000" },
    };
    await submitAudited("trust.COLD.RLUSD", cold, trust);
  } else {
    console.log(`  • RLUSD trustline exists (balance ${balance})`);
  }

  if (balance >= Number(want)) {
    console.log(`  • already holds ${balance} RLUSD ≥ ${want} — nothing to acquire`);
    await closeClient();
    return;
  }

  const need = (Number(want) - balance).toFixed(2);
  const intentId = ulid();
  const rlusd = iou(RLUSD_HEX, RLUSD_ISSUER, need);
  console.log(`  acquiring ${need} RLUSD via XRP→RLUSD AMM (self-payment)…`);
  const quote = await findRoute({
    source: cold.address,
    destination: cold.address,
    destinationAmount: rlusd,
    slippageTolerance: 0.02,
    sourceCurrencies: [{ currency: "XRP" }],
  });
  if (quote.result.no_route) throw new Error("no XRP→RLUSD route (AMM missing?)");
  appendAudit({ intent_id: intentId, actor: "system", event: "fund-cold.route", payload: quote.result });
  const res = await executeAuto({
    wallet: cold,
    destination: cold.address,
    deliverAmount: rlusd,
    sendMax: quote.sendMaxAmount,
    paths: quote.paths,
    intentId,
  });
  console.log(`\n✓ COLD funded with RLUSD: ${res.code}\n  ${res.explorer}`);
  await closeClient();
}

main().catch(async (e) => {
  console.error("fund-cold failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
