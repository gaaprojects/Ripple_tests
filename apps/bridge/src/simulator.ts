import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { DeviceInfo, SignRequest, SignResponse } from "@fx/shared";
import type { DeviceSigner } from "./signer.js";
import { compressedPubkeyHex, generatePrivateKeyHex, signDigestDerHex } from "./crypto.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/bridge/.device-key.json — gitignored; this keyfile IS the cold key (I2, labeled sim).
const KEYFILE = resolve(__dirname, "..", ".device-key.json");

const FW_VERSION = "sim-0.1.0";
const SIGN_DELAY_MS = 2000; // artificial "confirm on device" delay (SPEC §5.2)

/**
 * Labeled software signer (DEVICE_MODE=simulator, D12). Identical API to hardware.
 * Stable pubkey across reboots: the private key is persisted to a local keyfile.
 */
export class SimulatorSigner implements DeviceSigner {
  readonly simulated = true;
  private privHex: string;

  constructor() {
    if (existsSync(KEYFILE)) {
      this.privHex = JSON.parse(readFileSync(KEYFILE, "utf8")).privHex;
    } else {
      this.privHex = generatePrivateKeyHex();
      writeFileSync(KEYFILE, JSON.stringify({ privHex: this.privHex }, null, 2), {
        mode: 0o600,
      });
    }
  }

  async getInfo(): Promise<DeviceInfo> {
    return {
      pubkey: compressedPubkeyHex(this.privHex),
      fw_version: FW_VERSION,
      simulated: true,
    };
  }

  async sign(req: SignRequest, onAwaiting?: () => void): Promise<SignResponse> {
    onAwaiting?.();
    await new Promise((r) => setTimeout(r, Math.min(SIGN_DELAY_MS, req.timeout_ms)));
    // The simulator auto-approves after the delay. The dashboard badge makes this loud.
    const signature_der_hex = signDigestDerHex(req.digest_hex, this.privHex);
    return { request_id: req.request_id, outcome: "SIGNED", signature_der_hex };
  }
}
