/**
 * Orchestrate the one-time provisioning chain (SPEC §5.1), in order. Each step is idempotent-ish
 * and skips work already present. Steps that need manual RLUSD funding (RLUSD/XRP AMM, smoke
 * payment) report clearly and don't fail the chain.
 *
 * Prereq for set-regular-key: the bridge must be running (pnpm dev:bridge).
 * Run: pnpm --filter @fx/provisioning exec tsx run-all.ts
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STEPS = [
  "verify-rlusd.ts",
  "fund-accounts.ts",
  "trustlines.ts",
  "mint-eud.ts",
  "create-amms.ts",
  "set-regular-key.ts",
];

for (const step of STEPS) {
  console.log(`\n=== ${step} ===`);
  const r = spawnSync("npx", ["tsx", resolve(__dirname, step)], {
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) {
    console.error(`\nStep ${step} exited ${r.status}. Fix and re-run run-all (idempotent).`);
    process.exit(r.status ?? 1);
  }
}

console.log("\nAll provisioning steps complete. Run smoke-payment.ts once HOT holds RLUSD.");
