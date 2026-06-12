/**
 * Issue + accept the XLS-70 KYC credential for COUNTERPARTY_OK (SPEC §5.4):
 *   1. CredentialCreate  — COMPLIANCE_ISSUER attests KYC for the subject
 *   2. CredentialAccept  — the subject accepts (lsfAccepted; only then is it valid)
 * COUNTERPARTY_NEW deliberately gets NO credential (demo: credential_found=false -> VETO).
 * Idempotent: checks ledger_entry first and skips what already exists.
 *
 * Run: pnpm --filter @fx/provisioning exec tsx issue-credentials.ts
 */
import type { Transaction } from "xrpl";
import { KYC_CREDENTIAL_TYPE_HEX } from "@fx/core";
import { getClient, closeClient, walletFromEnv, requireEnv, submitAudited } from "./lib.js";

const LSF_ACCEPTED = 0x00010000;

async function credentialState(
  subject: string,
  issuer: string,
): Promise<"missing" | "created" | "accepted"> {
  const client = await getClient();
  try {
    const res = (await client.request({
      command: "ledger_entry",
      credential: { subject, issuer, credential_type: KYC_CREDENTIAL_TYPE_HEX },
      ledger_index: "validated",
    } as never)) as { result: { node?: { Flags?: number } } };
    return ((res.result.node?.Flags ?? 0) & LSF_ACCEPTED) !== 0 ? "accepted" : "created";
  } catch (err) {
    if (String(err).includes("entryNotFound")) return "missing";
    throw err;
  }
}

async function main() {
  await getClient();
  const issuer = walletFromEnv("COMPLIANCE_ISSUER_SEED");
  const subjectAddr = requireEnv("COUNTERPARTY_OK_ADDRESS");
  const subject = walletFromEnv("COUNTERPARTY_OK_SEED");
  if (subject.address !== subjectAddr) {
    throw new Error("COUNTERPARTY_OK_SEED does not match COUNTERPARTY_OK_ADDRESS");
  }

  console.log(`KYC credential: issuer ${issuer.address} -> subject ${subjectAddr}`);
  let state = await credentialState(subjectAddr, issuer.address);
  console.log(`  current state: ${state}`);

  if (state === "missing") {
    const create = {
      TransactionType: "CredentialCreate",
      Account: issuer.address,
      Subject: subjectAddr,
      CredentialType: KYC_CREDENTIAL_TYPE_HEX,
    } as unknown as Transaction;
    await submitAudited("credential.create", issuer, create);
    state = "created";
  }

  if (state === "created") {
    const accept = {
      TransactionType: "CredentialAccept",
      Account: subject.address,
      Issuer: issuer.address,
      CredentialType: KYC_CREDENTIAL_TYPE_HEX,
    } as unknown as Transaction;
    await submitAudited("credential.accept", subject, accept);
  }

  const finalState = await credentialState(subjectAddr, issuer.address);
  if (finalState !== "accepted") throw new Error(`expected accepted, got ${finalState}`);
  console.log("  ✓ credential issued AND accepted (lsfAccepted set) — visible on explorer");
  await closeClient();
}

main().catch(async (e) => {
  console.error("issue-credentials failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
