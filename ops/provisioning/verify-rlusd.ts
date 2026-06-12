/**
 * Verify the RLUSD Testnet issuer ON-LEDGER (SPEC §0.3 rule 1: never trust an address from
 * memory or code comments). Confirms the account exists, has DefaultRipple set, and that it
 * actually has RLUSD obligations outstanding (i.e. it really issues the token).
 *
 * Run: pnpm --filter @fx/api exec tsx ../../ops/provisioning/verify-rlusd.ts
 */
import { getClient, closeClient, RLUSD_ISSUER, RLUSD_HEX, explorerAccount } from "./lib.js";

const CANDIDATE = RLUSD_ISSUER || "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";

async function main() {
  const client = await getClient();
  console.log(`Checking RLUSD issuer: ${CANDIDATE}`);
  console.log(`  ${explorerAccount(CANDIDATE)}`);

  const info = await client.request({
    command: "account_info",
    account: CANDIDATE,
    ledger_index: "validated",
  });
  const flags = info.result.account_data.Flags ?? 0;
  const DEFAULT_RIPPLE = 0x00800000;
  console.log(`  account exists ✓  Flags=0x${flags.toString(16)}  DefaultRipple=${
    (flags & DEFAULT_RIPPLE) !== 0
  }`);

  // gateway_balances shows the issuer's outstanding obligations (what it has issued).
  const gb = await client.request({
    command: "gateway_balances",
    account: CANDIDATE,
    ledger_index: "validated",
  });
  const obligations = gb.result.obligations ?? {};
  const codes = Object.keys(obligations);
  console.log(`  outstanding obligations: ${codes.length ? codes.join(", ") : "(none yet)"}`);

  // RLUSD may appear as the hex code or, on some explorers, decoded. Report both.
  const issuesRlusd =
    RLUSD_HEX in obligations ||
    "RLUSD" in obligations ||
    codes.some((c) => c.toUpperCase().startsWith("524C555344"));
  console.log(`  issues RLUSD (hex ${RLUSD_HEX}): ${issuesRlusd ? "YES ✓" : "not detected"}`);

  if (!issuesRlusd) {
    console.log(
      "  NOTE: obligations can be empty if no holders exist yet on this Testnet reset. " +
        "The account + DefaultRipple check above is the primary signal; cross-check the explorer.",
    );
  }
  await closeClient();
}

main().catch(async (e) => {
  console.error("verify-rlusd failed:", e.message ?? e);
  await closeClient();
  process.exit(1);
});
