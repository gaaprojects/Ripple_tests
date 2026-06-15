# firefly-bridge — local hardware bridge

Runs **only on the operator's machine.** It owns the connection to the Firefly
device (github.com/firefly) and exposes a localhost endpoint the dashboard calls
to request an approval signature. The Railway API never talks to hardware
directly — the signature travels browser → API, and the API verifies it before
releasing funds.

## How it works

1. The dashboard POSTs the actual payment fields
   `{ paymentId, amount, currency, dest, reference }` to
   `http://localhost:4747/sign` — not a server-derived hash.
2. The bridge **derives the digest locally** from those fields (WYSIWYS), so the
   device signs exactly what the operator sees; every shown field is bound in.
3. The Firefly **displays the request and waits for the physical button press**,
   then returns a secp256k1 signature.
4. The dashboard sends the signature to the API, which verifies it against the
   registered public key and submits EscrowFinish.

During development a `MockFireflyDevice` signs with a local key so the whole flow
works without hardware. Swap it for a serial implementation that drives the real
board (see `src/device.ts`).

## Setup

```bash
npm install                                   # from repo root
npm run keygen --workspace apps/firefly-bridge
```

Copy the printed values into the repo-root `.env`: `FIREFLY_MOCK_PRIVATE_KEY`
(read by this bridge) and `FIREFLY_PUBLIC_KEY` (read by the API). The bridge
auto-loads the root `.env`; an exported `FIREFLY_MOCK_PRIVATE_KEY` still wins.
Then:

```bash
npm run dev:bridge        # http://localhost:4747
```

## Byte formats (must match the API verifier)

- Signature: 65 bytes — `r(32) || s(32) || recovery(1)`, hex.
- Public key: 64 bytes — uncompressed secp256k1 without the `0x04` prefix, hex.

These match `eth_keys` as used in `apps/api/app/tools/firefly.py`. When wiring the
real Firefly, confirm its output matches these or adapt the verifier.
