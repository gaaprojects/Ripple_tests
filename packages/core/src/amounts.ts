import type { PaymentIntent } from "@fx/shared";
import { config } from "./config.js";
import { eudIssuerAddress } from "./wallets.js";
import type { XrplAmount } from "./routing.js";

/**
 * Amount helpers: normalize intent amounts to RLUSD-equivalent for the gate (SPEC §5.7)
 * using the documented static demo rates, and build the exact XRPL delivery amount.
 */

export function toRlusdEquivalent(value: number, currency: "RLUSD" | "EUD" | "XRP"): number {
  switch (currency) {
    case "RLUSD":
      return value;
    case "EUD":
      return value * config.rateEudRlusd;
    case "XRP":
      return value * config.rateXrpRlusd;
  }
}

/** Exact delivered amount for the Payment's Amount field (never partial — SPEC §5.6). */
export function intentDeliverAmount(intent: PaymentIntent): XrplAmount {
  const v = String(intent.amount.value);
  switch (intent.amount.currency) {
    case "XRP":
      return String(Math.round(intent.amount.value * 1_000_000)); // drops
    case "RLUSD":
      return { currency: config.rlusdHex, issuer: config.rlusdIssuer, value: v };
    case "EUD":
      return { currency: config.eudCurrency, issuer: eudIssuerAddress(), value: v };
  }
}
