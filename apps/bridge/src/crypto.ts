import { secp256k1 } from "@noble/curves/secp256k1";

/**
 * secp256k1 over a raw 32-byte digest, producing the SAME signature shape the real
 * Firefly firmware must emit: canonical **low-S DER** (SPEC §5.2). The host computes
 * the digest via xrpl.js encodeForSigning; the device/simulator never parses XRPL.
 */

export function toHexUpper(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

export function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function generatePrivateKeyHex(): string {
  return toHexUpper(secp256k1.utils.randomPrivateKey());
}

/** Compressed 33-byte pubkey, hex uppercase — XRPL SigningPubKey convention. */
export function compressedPubkeyHex(privHex: string): string {
  return toHexUpper(secp256k1.getPublicKey(fromHex(privHex), true));
}

/** Sign a 32-byte digest. lowS:true enforces canonical signatures. Returns DER hex. */
export function signDigestDerHex(digestHex: string, privHex: string): string {
  const sig = secp256k1.sign(fromHex(digestHex), fromHex(privHex), { lowS: true });
  return sig.toDERHex().toUpperCase();
}

export function verifyDigestDerHex(
  digestHex: string,
  derHex: string,
  pubHex: string,
): boolean {
  return secp256k1.verify(fromHex(derHex), fromHex(digestHex), fromHex(pubHex), {
    lowS: true,
  });
}
