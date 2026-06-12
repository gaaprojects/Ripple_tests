import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComplianceResult } from "@fx/shared";
import { REPO_ROOT } from "./config.js";
import { xrplClient } from "./xrpl/client.js";

/**
 * Compliance service (SPEC §5.4) — two deterministic checks, fail-closed:
 *  1. Off-ledger sanctions screen against the versioned SYNTHETIC list in data/sanctions/.
 *  2. On-ledger XLS-70 credential: ledger_entry lookup for a KYC credential issued by
 *     COMPLIANCE_ISSUER to the destination AND accepted by the subject (lsfAccepted).
 * Any unexpected failure -> degraded:true, which the gate turns into a forced BLOCK.
 */

/** XLS-70 Credential ledger entry: lsfAccepted flag (verified via xrpl.org MCP). */
const LSF_ACCEPTED = 0x00010000;

/** Demo credential type: "KYC" as uppercase hex (CredentialType is a hex blob on-ledger). */
export const KYC_CREDENTIAL_TYPE_HEX = Buffer.from("KYC", "utf8").toString("hex").toUpperCase();

interface SanctionsList {
  version: string;
  entries: Array<{ name?: string; address?: string; list?: string; reason?: string }>;
}

let _sanctions: SanctionsList | null = null;

export function loadSanctions(): SanctionsList {
  if (_sanctions) return _sanctions;
  const raw = readFileSync(resolve(REPO_ROOT, "data/sanctions/sanctions.json"), "utf8");
  _sanctions = JSON.parse(raw) as SanctionsList;
  return _sanctions;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Exact address match + normalized name match against the synthetic list. */
export function sanctionsHit(address: string, name?: string): boolean {
  const list = loadSanctions();
  for (const e of list.entries) {
    if (e.address && e.address === address) return true;
    if (name && e.name && norm(e.name) === norm(name)) return true;
  }
  return false;
}

/** ledger_entry Credential lookup (subject+issuer+type). */
async function credentialStatus(
  subject: string,
  issuer: string,
): Promise<{ found: boolean; accepted: boolean }> {
  const client = await xrplClient();
  try {
    const res = (await client.request({
      command: "ledger_entry",
      credential: { subject, issuer, credential_type: KYC_CREDENTIAL_TYPE_HEX },
      ledger_index: "validated",
    } as never)) as { result: { node?: { Flags?: number } } };
    const flags = res.result.node?.Flags ?? 0;
    return { found: true, accepted: (flags & LSF_ACCEPTED) !== 0 };
  } catch (err) {
    // entryNotFound is a NEGATIVE result, not a service failure. xrpl.js RippledError keeps
    // the code in err.data.error ("entryNotFound") and a prose message ("Entry not found.").
    const code = (err as { data?: { error?: string } }).data?.error;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "entryNotFound" || msg.includes("entryNotFound") || /entry not found/i.test(msg)) {
      return { found: false, accepted: false };
    }
    throw err;
  }
}

export interface ComplianceParams {
  destination: string;
  beneficiaryName?: string;
  complianceIssuer: string;
}

export async function runCompliance(p: ComplianceParams): Promise<ComplianceResult> {
  const now = () => new Date().toISOString();
  try {
    const list = loadSanctions();
    const sanctioned = sanctionsHit(p.destination, p.beneficiaryName);
    // A sanctioned hit short-circuits: no need to consult the ledger to BLOCK.
    if (sanctioned) {
      return {
        sanctioned: true,
        credential_found: false,
        credential_accepted: false,
        sources: [`sanctions:${list.version}`],
        degraded: false,
        checked_at: now(),
      };
    }
    const cred = await credentialStatus(p.destination, p.complianceIssuer);
    return {
      sanctioned: false,
      credential_found: cred.found,
      credential_accepted: cred.accepted,
      sources: [`sanctions:${list.version}`, "ledger:credential"],
      degraded: false,
      checked_at: now(),
    };
  } catch {
    // Fail-closed: the gate maps degraded compliance to a forced BLOCK (SPEC §5.3).
    return {
      sanctioned: false,
      credential_found: false,
      credential_accepted: false,
      sources: [],
      degraded: true,
      checked_at: now(),
    };
  }
}
