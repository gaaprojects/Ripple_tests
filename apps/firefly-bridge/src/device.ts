import { sha256 } from "@noble/hashes/sha256";
import { secp256k1 } from "@noble/curves/secp256k1";
import type { BridgeSignRequest } from "@treasury/shared";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

// Signature/public-key byte formats are chosen to match the API's verifier
// (eth_keys in apps/api/app/tools/firefly.py):
//   - signature: 65 bytes, r(32) || s(32) || recovery(1), hex.
//   - publicKey: 64 bytes, uncompressed without the 0x04 prefix, hex.
export interface SignedApproval {
  signature: string;
  publicKey: string;
}

export interface FireflyDevice {
  /** Display the payment and sign once the button is pressed. */
  sign(req: BridgeSignRequest): Promise<SignedApproval>;
  publicKeyHex(): string;
}

/**
 * Canonical payload format — MUST stay identical to Python firefly.py:
 *   f"{payment_id}|{amount:.2f}|{currency}|{dest}"
 *
 * Any change here must be mirrored in apps/api/app/tools/firefly.py.
 */
export function deriveDigest(req: BridgeSignRequest): string {
  const canonical = `${req.paymentId}|${req.amount.toFixed(2)}|${req.currency}|${req.dest}`;
  const hash = sha256(new TextEncoder().encode(canonical));
  return Buffer.from(hash).toString("hex");
}

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function uncompressedNoPrefix(privateKey: Uint8Array): string {
  const full = secp256k1.getPublicKey(privateKey, false); // 65 bytes, leading 0x04
  return Buffer.from(full.slice(1)).toString("hex");
}

/**
 * Stand-in for the real Firefly hardware during development. Signs with a local
 * secp256k1 key so the full approve→verify→release flow works offline.
 */
export class MockFireflyDevice implements FireflyDevice {
  private readonly privateKey: Uint8Array;

  constructor(privateKeyHex: string) {
    this.privateKey = Buffer.from(strip0x(privateKeyHex), "hex");
  }

  publicKeyHex(): string {
    return uncompressedNoPrefix(this.privateKey);
  }

  async sign(req: BridgeSignRequest): Promise<SignedApproval> {
    const digestHex = deriveDigest(req);
    const digest = Buffer.from(digestHex, "hex");
    const sig = secp256k1.sign(digest, this.privateKey);
    const signature = Buffer.concat([
      sig.toCompactRawBytes(),
      Buffer.from([sig.recovery]),
    ]).toString("hex");
    return { signature, publicKey: this.publicKeyHex() };
  }
}

/**
 * Real Firefly hardware adapter (ESP32-C3, secp256k1) over USB/serial.
 *
 * Serial protocol — newline-delimited JSON in both directions:
 *   → { paymentId, amount (2dp string), currency, dest, reference, digest }
 *   ← { signature: "<65-byte r+s+v hex>" }  on approve
 *   ← { error: "<reason>" }                 on reject
 *
 * The device shows the WYSIWYS fields on its screen and waits for a physical
 * button press before signing. The verify path on the API side is unchanged —
 * it verifies the returned signature against FIREFLY_PUBLIC_KEY with eth_keys.
 *
 * Byte format (MUST match the API verifier):
 *   signature: 65 bytes r(32)||s(32)||recovery(1), hex.
 *   publicKey: 64 bytes uncompressed secp256k1 without 0x04 prefix, hex.
 */
export class SerialFireflyDevice implements FireflyDevice {
  private readonly _publicKeyHex: string;
  private readonly port: SerialPort;
  private readonly parser: ReadlineParser;
  private pendingResolve: ((val: SignedApproval) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;

  constructor(serialPath: string, publicKeyHex: string, baudRate = 115200) {
    this._publicKeyHex = strip0x(publicKeyHex);
    this.port = new SerialPort({ path: serialPath, baudRate, autoOpen: true });
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: "\n" }));
    this.parser.on("data", (line: string) => this._onLine(line));
    this.port.on("error", (err: Error) => this._onError(err));
  }

  publicKeyHex(): string {
    return this._publicKeyHex;
  }

  async sign(req: BridgeSignRequest): Promise<SignedApproval> {
    if (this.pendingResolve !== null) {
      throw new Error("A sign request is already in progress — wait for button press");
    }
    const digest = deriveDigest(req);
    const payload =
      JSON.stringify({
        paymentId: req.paymentId,
        amount: req.amount.toFixed(2),
        currency: req.currency,
        dest: req.dest,
        reference: req.reference ?? "",
        digest,
      }) + "\n";

    return new Promise<SignedApproval>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.port.write(payload, (err?: Error | null) => {
        if (err) {
          this.pendingResolve = null;
          this.pendingReject = null;
          reject(err);
        }
      });
    });
  }

  private _onLine(line: string): void {
    if (!this.pendingResolve || !this.pendingReject) return;
    const resolve = this.pendingResolve;
    const reject = this.pendingReject;
    this.pendingResolve = null;
    this.pendingReject = null;
    try {
      const resp = JSON.parse(line.trim()) as { signature?: string; error?: string };
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      if (!resp.signature) {
        reject(new Error("No signature in device response"));
        return;
      }
      resolve({ signature: strip0x(resp.signature), publicKey: this._publicKeyHex });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private _onError(err: Error): void {
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      reject(err);
    } else {
      console.error("[firefly-serial] port error:", err.message);
    }
  }
}
