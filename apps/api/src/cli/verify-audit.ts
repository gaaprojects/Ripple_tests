// Hash-chain verification command (SPEC §5.13 acceptance).
// Run: pnpm --filter @fx/api exec tsx src/cli/verify-audit.ts
import { verifyChain } from "@fx/core";

const result = verifyChain();
if (result.ok) {
  console.log(`OK — audit chain intact (${result.count} records)`);
  process.exit(0);
} else {
  console.error(
    `TAMPER DETECTED — broken at ${result.brokenAt} (${result.reason}); ${result.count} records`,
  );
  process.exit(1);
}
