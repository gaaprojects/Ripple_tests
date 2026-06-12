import { secp256k1 } from "@noble/curves/secp256k1";

/**
 * Local verification of the device's signature BEFORE submit (SPEC §0.3 rule 2): the only
 * crypto outside the SDK is the secp256k1 signature produced on the device; we verify it
 * against the device pubkey over the exact digest we sent, enforcing canonical low-S.
 */
export function verifyDeviceSignature(digestHex: string, derHex: string, pubkeyHex: string): boolean {
  const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
  try {
    return secp256k1.verify(hex(derHex), hex(digestHex), hex(pubkeyHex), { lowS: true });
  } catch {
    return false;
  }
}
