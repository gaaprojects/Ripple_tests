import { z } from "zod";

/**
 * Bridge protocol (SPEC §6) — JSON-lines over USB serial, mirrored on local HTTP/WS.
 * IDENTICAL shape for hardware and simulator (D12): flipping DEVICE_MODE changes nothing here.
 */

// GET_INFO -> device identity
export const DeviceInfo = z.object({
  pubkey: z.string(), // compressed secp256k1, hex
  fw_version: z.string(),
  simulated: z.boolean().default(false), // drives the loud "SIMULATED DEVICE" UI badge
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

// Host-supplied display fields rendered on-device (D2 — known limitation: not digest-derived).
export const SignDisplay = z.object({
  destination: z.string(),
  amount: z.string(),
  currency: z.string(),
  purpose: z.string(),
});
export type SignDisplay = z.infer<typeof SignDisplay>;

export const SignRequest = z.object({
  request_id: z.string(),
  digest_hex: z.string(), // 32-byte signing digest (computed host-side via encodeForSigning)
  display: SignDisplay,
  timeout_ms: z.number().int().positive().default(120_000),
});
export type SignRequest = z.infer<typeof SignRequest>;

export const SignOutcome = z.enum(["SIGNED", "REJECTED", "TIMEOUT"]);
export type SignOutcome = z.infer<typeof SignOutcome>;

export const SignResponse = z.object({
  request_id: z.string(),
  outcome: SignOutcome,
  signature_der_hex: z.string().optional(), // canonical low-S DER secp256k1, only when SIGNED
});
export type SignResponse = z.infer<typeof SignResponse>;

/** WS events emitted by the bridge to the dashboard. */
export const BridgeEvent = z.enum([
  "device_connected",
  "awaiting_confirmation",
  "approved",
  "rejected",
  "timeout",
]);
export type BridgeEvent = z.infer<typeof BridgeEvent>;
