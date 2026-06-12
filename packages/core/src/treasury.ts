import type { TreasuryState } from "@fx/shared";
import { config, loadPolicy } from "./config.js";
import { xrplClient } from "./xrpl/client.js";
import { hotWallet, coldTreasuryAddress } from "./wallets.js";
import { floatUsedRlusd, floatHeadroomRlusd } from "./float.js";

/** Live balances + float gauge for the dashboard Treasury view (SPEC §5.14). */

async function xrpBalance(address: string): Promise<number> {
  const client = await xrplClient();
  try {
    const res = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    return Number(res.result.account_data.Balance) / 1_000_000;
  } catch {
    return 0;
  }
}

async function iouBalance(address: string, currency: string, issuer: string): Promise<number> {
  const client = await xrplClient();
  try {
    const res = await client.request({ command: "account_lines", account: address, peer: issuer });
    const line = res.result.lines.find((l) => l.currency === currency);
    return line ? Number(line.balance) : 0;
  } catch {
    return 0;
  }
}

export async function getTreasuryState(eudIssuer: string): Promise<TreasuryState> {
  const policy = loadPolicy();
  const hot = hotWallet().address;
  const cold = coldTreasuryAddress();
  const [hotXrp, hotRlusd, hotEud, coldXrp, coldRlusd] = await Promise.all([
    xrpBalance(hot),
    iouBalance(hot, config.rlusdHex, config.rlusdIssuer),
    iouBalance(hot, config.eudCurrency, eudIssuer),
    xrpBalance(cold),
    iouBalance(cold, config.rlusdHex, config.rlusdIssuer),
  ]);
  return {
    hot_address: hot,
    cold_address: cold,
    hot_xrp: hotXrp,
    hot_rlusd: hotRlusd,
    hot_eud: hotEud,
    cold_xrp: coldXrp,
    cold_rlusd: coldRlusd,
    float_cap_rlusd: policy.hot_float_cap_rlusd,
    float_used_rlusd: floatUsedRlusd(),
    float_headroom_rlusd: floatHeadroomRlusd(policy.hot_float_cap_rlusd),
    checked_at: new Date().toISOString(),
  };
}
