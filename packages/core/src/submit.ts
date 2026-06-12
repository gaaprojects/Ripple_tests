import type { SubmittableTransaction, TxResponse, Wallet } from "xrpl";
import { xrplClient } from "./xrpl/client.js";
import { appendAudit } from "./audit.js";
import { explorerTxUrl } from "./config.js";

export function txResultCode(res: TxResponse): string {
  const meta = res.result.meta;
  return meta && typeof meta === "object" && "TransactionResult" in meta
    ? (meta as { TransactionResult: string }).TransactionResult
    : "unknown";
}

/**
 * Submit a transaction with audit-before + audit-after (SPEC §0.3 rule 4, I4): autofill →
 * local sign → submitAndWait → assert tesSUCCESS. Shared by provisioning and the AUTO executor.
 */
export async function submitAudited(
  label: string,
  wallet: Wallet,
  tx: SubmittableTransaction,
  intentId: string | null = null,
): Promise<TxResponse> {
  const client = await xrplClient();
  const prepared = await client.autofill(tx);
  appendAudit({
    intent_id: intentId,
    actor: "system",
    event: `${label}.submitting`,
    payload: { account: wallet.address, tx: prepared as unknown as Record<string, unknown> },
  });
  const signed = wallet.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  const code = txResultCode(res);
  appendAudit({
    intent_id: intentId,
    actor: "system",
    event: `${label}.result`,
    payload: { hash: res.result.hash, code, explorer: explorerTxUrl(res.result.hash) },
  });
  if (code !== "tesSUCCESS") {
    throw new Error(`${label} failed: ${code} (${explorerTxUrl(res.result.hash)})`);
  }
  console.log(`  ✓ ${label}: ${code}  ${explorerTxUrl(res.result.hash)}`);
  return res;
}
