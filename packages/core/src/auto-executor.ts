import type { Payment, Wallet } from "xrpl";
import { submitAudited, txResultCode } from "./submit.js";
import { explorerTxUrl } from "./config.js";
import type { XrplAmount } from "./routing.js";

function hex(s: string): string {
  return Buffer.from(s, "utf8").toString("hex").toUpperCase();
}

export interface ExecuteAutoParams {
  wallet: Wallet; // HOT_ACCOUNT
  destination: string;
  deliverAmount: XrplAmount; // exact delivered amount
  sendMax: XrplAmount; // bounded source cap
  paths?: Record<string, unknown>[]; // paths_computed from the route's best alternative
  intentId: string;
}

export interface ExecuteAutoResult {
  hash: string;
  code: string;
  explorer: string;
}

/**
 * AUTO-path executor (SPEC §5.8). Builds a Payment from HOT_ACCOUNT with exact Amount and
 * bounded SendMax — **never** tfPartialPayment (the partial-payment exploit class a treasury
 * must avoid, SPEC §5.6). Idempotency via the intent id in a Memo; fresh Sequence and
 * LastLedgerSequence come from autofill (§5.8). submitAudited writes before/after audit records.
 */
export async function executeAuto(p: ExecuteAutoParams): Promise<ExecuteAutoResult> {
  const tx: Payment = {
    TransactionType: "Payment",
    Account: p.wallet.address,
    Destination: p.destination,
    Amount: p.deliverAmount as never,
    SendMax: p.sendMax as never,
    Memos: [
      {
        Memo: {
          MemoType: hex("intent_id"),
          MemoData: hex(p.intentId),
        },
      },
    ],
  };
  if (p.paths && p.paths.length) {
    (tx as { Paths?: unknown }).Paths = p.paths as never;
  }

  const res = await submitAudited(`exec.auto`, p.wallet, tx, p.intentId);
  return {
    hash: res.result.hash,
    code: txResultCode(res),
    explorer: explorerTxUrl(res.result.hash),
  };
}
