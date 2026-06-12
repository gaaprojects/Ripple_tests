/**
 * Dev utility: truncate the audit_log to a clean genesis. Used once after fixing the
 * canonical-JSON/JSON.stringify asymmetry bug, since records appended under the bug carry
 * permanently-inconsistent hashes (stored hash computed WITH undefined keys, stored payload
 * dropped them). Testnet dev data only — never run against a real audit trail.
 *
 * Run: pnpm --filter @fx/provisioning exec tsx reset-audit.ts
 */
import { db } from "@fx/core";

const before = (db().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
db().prepare("DELETE FROM audit_log").run();
console.log(`audit_log reset: removed ${before} record(s); chain is now genesis.`);
