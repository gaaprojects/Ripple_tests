# firefly-bridge — local hardware bridge

Runs **only on the operator's machine.** It owns the connection to the Firefly
device (github.com/firefly) and exposes a localhost endpoint the dashboard calls
to request an approval signature. The Railway API never talks to hardware
directly — the signature travels browser → API, and the API verifies it before
releasing funds.

## How it works

1. The dashboard POSTs the payment fields to `http://localhost:4747/sign`.
2. The bridge derives the canonical digest (`sha256(paymentId|amount|currency|dest)`)
   and sends the WYSIWYS payload to the device.
3. The Firefly **displays the payment on its screen and waits for the physical
   button press**, then returns a secp256k1 signature.
4. The dashboard forwards the signature to the API, which verifies it against
   `FIREFLY_PUBLIC_KEY` and releases the EscrowFinish.

Two adapters are available, selected by `DEVICE_MODE`:

| Mode | Adapter | Use |
|---|---|---|
| `simulator` (default) | `MockFireflyDevice` | Local dev, CI, demo without hardware |
| `hardware` | `SerialFireflyDevice` | Real Firefly (ESP32-C3) over USB/serial |

The server-side verify path (`apps/api/app/tools/firefly.py`) is **identical** for
both modes — the adapter is purely a bridge concern.

## Simulator setup (default — no hardware needed)

```bash
npm install                                   # from repo root
npm run keygen --workspace apps/firefly-bridge
```

Copy the printed values into the repo-root `.env`:
- `FIREFLY_MOCK_PRIVATE_KEY` — read by this bridge
- `FIREFLY_PUBLIC_KEY` — read by the API for signature verification

Then:

```bash
npm run dev:bridge        # http://localhost:4747
```

## Hardware setup (real Firefly, ESP32-C3)

1. Flash the Firefly firmware. The device must implement the serial protocol below.
2. Connect the device via USB. Note the serial port path
   (Linux: `/dev/ttyUSB0`, macOS: `/dev/tty.usbserial-*`, Windows: `COM3`).
3. Run one sign request in simulator mode first, copy `publicKey` from the JSON
   response, then set:

```env
DEVICE_MODE=hardware
BRIDGE_SERIAL_PORT=/dev/ttyUSB0   # adjust to your port
FIREFLY_PUBLIC_KEY=<64-byte hex from the device's first response>
```

4. Set the same `FIREFLY_PUBLIC_KEY` in the API's env so it can verify signatures.
5. Start the bridge:

```bash
DEVICE_MODE=hardware npm run dev:bridge
```

The bridge logs `Device mode: hardware (/dev/ttyUSB0)` on startup.

## Serial protocol (device firmware contract)

Newline-delimited JSON in both directions at 115 200 baud (configurable via
`BRIDGE_BAUD_RATE`).

**Bridge → device** (one JSON object per line):
```json
{
  "paymentId": "uuid",
  "amount": "1000.00",
  "currency": "USD",
  "dest": "rXXX...",
  "reference": "INV-001",
  "digest": "sha256hex"
}
```

**Device → bridge** on approve:
```json
{ "signature": "<65-byte r+s+v hex>" }
```

**Device → bridge** on reject / error:
```json
{ "error": "rejected by operator" }
```

The device must display the `amount`, `currency`, `dest`, and `reference` fields
on its screen (WYSIWYS — What You See Is What You Sign) and only sign after the
physical button is pressed.

## Byte formats (must match the API verifier)

- **Signature:** 65 bytes — `r(32) || s(32) || recovery(1)`, hex.
- **Public key:** 64 bytes — uncompressed secp256k1 without the `0x04` prefix, hex.

These match `eth_keys` as used in `apps/api/app/tools/firefly.py`. Confirm the
device's output matches these formats exactly before going live — a mismatch
produces a persistent 403 on every release attempt.
