/**
 * Wire the Firefly device key as the RegularKey on COLD_TREASURY (SPEC §5.1, D3). The device
 * (or simulator) holds the secp256k1 key; we read its pubkey via the bridge, derive the classic
 * address, and SetRegularKey on the cold account signed by the cold MASTER seed (transient,
 * read from the gitignored secrets file — never from .env, never at runtime).
 *
 * The VETO signing flow that USES this key is P4; here we only establish it.
 *
 * Prereq: bridge running (pnpm dev:bridge). Run: pnpm --filter @fx/provisioning exec tsx set-regular-key.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wallet, deriveAddress, type SetRegularKey } from "xrpl";
import { getClient, closeClient, submitAudited, REPO_ROOT, explorerAccount } from "./lib.js";

const BRIDGE = `http://127.0.0.1:${process.env.BRIDGE_HTTP_PORT ?? "8787"}`;
const SECRETS = resolve(REPO_ROOT, "ops/provisioning/.provision-secrets.json");

async function devicePubkey(): Promise<string> {
  const res = await fetch(`${BRIDGE}/device/info`);
  if (!res.ok) throw new Error(`bridge /device/info ${res.status} — is the bridge running?`);
  const info = (await res.json()) as { pubkey: string; simulated: boolean };
  console.log(`  device pubkey: ${info.pubkey}${info.simulated ? " (SIMULATED)" : ""}`);
  return info.pubkey;
}

function coldMasterSeed(): string {
  if (!existsSync(SECRETS)) {
    throw new Error(
      "Missing ops/provisioning/.provision-secrets.json — run fund-accounts.ts first (it writes the cold master seed there).",
    );
  }
  const seed = JSON.parse(readFileSync(SECRETS, "utf8")).COLD_TREASURY_SEED as string;
  if (!seed) throw new Error("COLD_TREASURY_SEED missing from secrets file");
  return seed;
}

async function main() {
  await getClient();
  const pubkey = await devicePubkey();
  // Classic address derived from the device's compressed secp256k1 pubkey.
  const regularKeyAddress = deriveAddress(pubkey);
  console.log(`  derived RegularKey address: ${regularKeyAddress}`);

  const cold = Wallet.fromSeed(coldMasterSeed());
  console.log(`  cold treasury: ${cold.address}  ${explorerAccount(cold.address)}`);

  const tx: SetRegularKey = {
    TransactionType: "SetRegularKey",
    Account: cold.address,
    RegularKey: regularKeyAddress,
  };
  await submitAudited("setRegularKey", cold, tx);

  // Verify on-ledger.
  const client = await getClient();
  const info = await client.request({
    command: "account_info",
    account: cold.address,
    ledger_index: "validated",
  });
  const onLedger = info.result.account_data.RegularKey;
  console.log(
    onLedger === regularKeyAddress
      ? `  ✓ verified: RegularKey = ${onLedger} (device-derived)`
      : `  ! mismatch: on-ledger RegularKey = ${onLedger}`,
  );
  await closeClient();
}

main().catch(async (e) => {
  console.error("set-regular-key failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
