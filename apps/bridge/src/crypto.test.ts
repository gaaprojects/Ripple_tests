import { describe, it, expect } from "vitest";
import {
  compressedPubkeyHex,
  generatePrivateKeyHex,
  signDigestDerHex,
  verifyDigestDerHex,
} from "./crypto.js";

const digest = "A".repeat(64); // a 32-byte digest, hex

describe("device crypto (secp256k1, low-S DER)", () => {
  it("signs a digest and verifies against the compressed pubkey", () => {
    const priv = generatePrivateKeyHex();
    const pub = compressedPubkeyHex(priv);
    expect(pub).toMatch(/^0[23][0-9A-F]{64}$/); // 33-byte compressed, uppercase
    const sig = signDigestDerHex(digest, priv);
    expect(verifyDigestDerHex(digest, sig, pub)).toBe(true);
  });

  it("rejects a signature over a different digest", () => {
    const priv = generatePrivateKeyHex();
    const pub = compressedPubkeyHex(priv);
    const sig = signDigestDerHex(digest, priv);
    expect(verifyDigestDerHex("B".repeat(64), sig, pub)).toBe(false);
  });

  it("derives a stable pubkey from the same private key", () => {
    const priv = generatePrivateKeyHex();
    expect(compressedPubkeyHex(priv)).toBe(compressedPubkeyHex(priv));
  });
});
