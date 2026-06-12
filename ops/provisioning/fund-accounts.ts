/**
 * Fund the demo accounts from the Testnet faucet and write their seeds/addresses to .env
 * (SPEC §5.1). Grows from the baseline fund-wallet.js. Idempotent-ish: re-running generates
 * fresh wallets only for keys not already present in .env, so existing accounts are preserved.
 *
 * OPS is funded multiple times for generous XRP headroom (AMMCreate special fee + reserves).
 * COLD_TREASURY's master seed is written to a gitignored secrets file (NOT .env), per SPEC §7
 * ("address only — never a seed"); set-regular-key.ts consumes it transiently.
 *
 * Run: pnpm --filter @fx/provisioning exec tsx fund-accounts.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wallet } from "xrpl";
import { getClient, closeClient, REPO_ROOT, explorerAccount } from "./lib.js";
import { readEnvFile, upsertEnv } from "./env-writer.js";

const SEED_VARS = [
  "HOT_SEED",
  "EUD_ISSUER_SEED",
  "COMPLIANCE_ISSUER_SEED",
  "OPS_SEED",
] as const;
const COUNTERPARTY_VARS = [
  "COUNTERPARTY_OK_ADDRESS",
  "COUNTERPARTY_NEW_ADDRESS",
  "COUNTERPARTY_SANCTIONED_ADDRESS",
] as const;

async function fundNew(label: string): Promise<Wallet> {
  const client = await getClient();
  const { wallet, balance } = await client.fundWallet();
  console.log(`  ✓ ${label}: ${wallet.address} (${balance} XRP)  ${explorerAccount(wallet.address)}`);
  return wallet;
}

async function main() {
  await getClient();
  const env = readEnvFile();
  const updates: Record<string, string> = {};

  console.log("Funding server-seed accounts…");
  for (const v of SEED_VARS) {
    if (env.get(v)) {
      console.log(`  • ${v} already set — skipping`);
      continue;
    }
    const label = v.replace("_SEED", "");
    const w = await fundNew(label);
    updates[v] = w.seed!;
    if (v === "OPS_SEED") {
      // Generous headroom for two AMMCreate calls + LP-token reserves.
      console.log("  …topping up OPS for AMM reserves");
      const client = await getClient();
      for (let i = 0; i < 4; i++) {
        try {
          await client.fundWallet(w);
        } catch {
          /* best effort */
        }
      }
    }
  }

  console.log("Funding counterparty accounts…");
  for (const v of COUNTERPARTY_VARS) {
    if (env.get(v)) {
      console.log(`  • ${v} already set — skipping`);
      continue;
    }
    const label = v.replace("_ADDRESS", "");
    const w = await fundNew(label);
    updates[v] = w.address;
    // OK/NEW need their seeds later (CredentialAccept, receiving). Store alongside.
    if (v !== "COUNTERPARTY_SANCTIONED_ADDRESS") updates[`${label}_SEED`] = w.seed!;
  }

  console.log("Funding COLD_TREASURY (master seed -> gitignored secrets file)…");
  if (!env.get("COLD_TREASURY_ADDRESS")) {
    const cold = await fundNew("COLD_TREASURY");
    updates["COLD_TREASURY_ADDRESS"] = cold.address;
    const secretsPath = resolve(REPO_ROOT, "ops/provisioning/.provision-secrets.json");
    writeFileSync(secretsPath, JSON.stringify({ COLD_TREASURY_SEED: cold.seed }, null, 2), {
      mode: 0o600,
    });
    console.log(`  ↳ cold master seed written to ops/provisioning/.provision-secrets.json (gitignored)`);
  } else {
    console.log("  • COLD_TREASURY_ADDRESS already set — skipping");
  }

  if (Object.keys(updates).length) {
    upsertEnv(updates);
    console.log(`\nWrote ${Object.keys(updates).length} keys to .env`);
  } else {
    console.log("\nNothing to fund — all accounts already in .env");
  }
  await closeClient();
}

main().catch(async (e) => {
  console.error("fund-accounts failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
