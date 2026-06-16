import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import type { BridgeSignRequest, BridgeSignResponse } from "@treasury/shared";

import { MockFireflyDevice, SerialFireflyDevice } from "./device.js";
import type { FireflyDevice } from "./device.js";

// Load the repo-root .env so Firefly env vars are available without manually
// exporting them. Real exported env vars win. Uses Node's built-in loader
// (>=20.12); a missing file or older Node is a no-op.
const ROOT_ENV = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
const loadEnvFile = (process as { loadEnvFile?: (path: string) => void }).loadEnvFile;
if (loadEnvFile && existsSync(ROOT_ENV)) {
  loadEnvFile(ROOT_ENV);
}

const PORT = Number(process.env.BRIDGE_PORT ?? 4747);

// DEVICE_MODE selects the Firefly adapter:
//   simulator (default) — signs with a local secp256k1 key (no hardware needed)
//   hardware            — drives a real Firefly (ESP32-C3) over USB/serial
const MODE = (process.env.DEVICE_MODE ?? "simulator") as "hardware" | "simulator";

let device: FireflyDevice;

if (MODE === "hardware") {
  const serialPath = process.env.BRIDGE_SERIAL_PORT;
  const pubKeyHex = process.env.FIREFLY_PUBLIC_KEY;
  if (!serialPath) {
    throw new Error(
      "BRIDGE_SERIAL_PORT is required when DEVICE_MODE=hardware " +
        "(e.g. /dev/ttyUSB0 on Linux, /dev/tty.usbserial-* on macOS, COM3 on Windows)",
    );
  }
  if (!pubKeyHex) {
    throw new Error(
      "FIREFLY_PUBLIC_KEY is required when DEVICE_MODE=hardware. " +
        "The device reports its public key in the sign response; " +
        "run one sign, copy the publicKey field, and set it here + in the API.",
    );
  }
  device = new SerialFireflyDevice(serialPath, pubKeyHex);
  console.log(`[firefly] Device mode: hardware (${serialPath})`);
} else {
  const mockKey = process.env.FIREFLY_MOCK_PRIVATE_KEY;
  if (!mockKey) {
    throw new Error(
      "FIREFLY_MOCK_PRIVATE_KEY is not set. Run `npm run keygen --workspace apps/firefly-bridge` " +
        "and put the private key here and the public key in the API's FIREFLY_PUBLIC_KEY.",
    );
  }
  device = new MockFireflyDevice(mockKey);
  console.log("[firefly] Device mode: simulator (MockFireflyDevice)");
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", mode: MODE, publicKey: device.publicKeyHex() });
});

app.post("/sign", async (req, res) => {
  const body = req.body as BridgeSignRequest;
  if (!body?.paymentId || !body?.amount || !body?.currency || !body?.dest) {
    res.status(400).json({ error: "paymentId, amount, currency, and dest are required" });
    return;
  }
  console.log(`[firefly] ┌─ APPROVE REQUEST ─────────────────────────────────┐`);
  console.log(`[firefly] │  Amount:    ${body.amount.toFixed(2)} ${body.currency}`);
  console.log(`[firefly] │  To:        ${body.dest}`);
  console.log(`[firefly] │  Reference: ${body.reference ?? "(none)"}`);
  console.log(`[firefly] │  Payment:   ${body.paymentId}`);
  console.log(`[firefly] └───────────────────────────────────────────────────┘`);
  if (MODE === "hardware") {
    console.log(`[firefly] Waiting for physical button press on device…`);
  } else {
    console.log(`[firefly] Awaiting button press… (simulator: signing immediately)`);
  }
  try {
    const signed = await device.sign(body);
    const response: BridgeSignResponse = {
      paymentId: body.paymentId,
      signature: signed.signature,
      publicKey: signed.publicKey,
    };
    console.log(`[firefly] ✓ Signed payment ${body.paymentId}`);
    res.json(response);
  } catch (cause) {
    console.error(`[firefly] signing failed: ${String(cause)}`);
    res.status(500).json({ error: "signing failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Firefly bridge listening on http://localhost:${PORT}`);
  console.log(`Device public key: ${device.publicKeyHex()}`);
});
