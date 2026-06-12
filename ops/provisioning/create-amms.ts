/**
 * Create the two project AMMs by OPS (SPEC §5.1, D4): RLUSD/XRP and XRP/EUD. Auto-bridging
 * through both lets RLUSD route to EUD via XRP. Sized small for Testnet faucet limits.
 *
 * The RLUSD/XRP pool needs OPS to hold RLUSD (obtained from Ripple's RLUSD Testnet web faucet —
 * a manual step). If OPS has no RLUSD, that pool is skipped with a clear notice; the XRP/EUD
 * pool still creates. Re-run after funding RLUSD to complete the pair.
 *
 * Run: pnpm --filter @fx/provisioning exec tsx create-amms.ts
 */
import { xrpToDrops, type AMMCreate } from "xrpl";
import {
  getClient,
  closeClient,
  walletFromEnv,
  submitAudited,
  RLUSD_ISSUER,
  RLUSD_HEX,
  EUD_CURRENCY,
  iou,
} from "./lib.js";

const TRADING_FEE = 500; // 0.5% (units of 1/100000; 1000 = 1%)
const XRP_PER_POOL = "30";
const RLUSD_PER_POOL = "30";
const EUD_PER_POOL = "30";

async function ammExists(asset: object, asset2: object): Promise<boolean> {
  const client = await getClient();
  try {
    await client.request({ command: "amm_info", asset, asset2 } as never);
    return true;
  } catch {
    return false;
  }
}

async function rlusdBalance(addr: string): Promise<number> {
  const client = await getClient();
  const lines = await client.request({ command: "account_lines", account: addr, peer: RLUSD_ISSUER });
  const line = lines.result.lines.find((l) => l.currency === RLUSD_HEX);
  return line ? Number(line.balance) : 0;
}

async function main() {
  const ops = walletFromEnv("OPS_SEED");
  const eudIssuer = walletFromEnv("EUD_ISSUER_SEED").address;

  // --- XRP / EUD pool ---
  const eudAsset = { currency: EUD_CURRENCY, issuer: eudIssuer };
  if (await ammExists({ currency: "XRP" }, eudAsset)) {
    console.log("• XRP/EUD AMM already exists — skipping");
  } else {
    const tx: AMMCreate = {
      TransactionType: "AMMCreate",
      Account: ops.address,
      Amount: xrpToDrops(XRP_PER_POOL),
      Amount2: iou(EUD_CURRENCY, eudIssuer, EUD_PER_POOL),
      TradingFee: TRADING_FEE,
    };
    await submitAudited("amm.XRP_EUD", ops, tx);
  }

  // --- RLUSD / XRP pool (needs OPS to hold RLUSD) ---
  const rlusdAsset = { currency: RLUSD_HEX, issuer: RLUSD_ISSUER };
  if (await ammExists(rlusdAsset, { currency: "XRP" })) {
    console.log("• RLUSD/XRP AMM already exists — skipping");
  } else {
    const bal = await rlusdBalance(ops.address);
    if (bal < Number(RLUSD_PER_POOL)) {
      console.log(
        `! RLUSD/XRP AMM SKIPPED — OPS holds ${bal} RLUSD (need ${RLUSD_PER_POOL}).\n` +
          `  Fund OPS (${ops.address}) from Ripple's RLUSD Testnet faucet, then re-run create-amms.`,
      );
    } else {
      const tx: AMMCreate = {
        TransactionType: "AMMCreate",
        Account: ops.address,
        Amount: iou(RLUSD_HEX, RLUSD_ISSUER, RLUSD_PER_POOL),
        Amount2: xrpToDrops(XRP_PER_POOL),
        TradingFee: TRADING_FEE,
      };
      await submitAudited("amm.RLUSD_XRP", ops, tx);
    }
  }

  console.log("AMM provisioning done.");
  await closeClient();
}

main().catch(async (e) => {
  console.error("create-amms failed:", e?.message ?? e);
  await closeClient();
  process.exit(1);
});
