import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import dotenv from "dotenv";
import { SignRequest } from "@fx/shared";
import type { DeviceSigner } from "./signer.js";
import { SimulatorSigner } from "./simulator.js";
import { HardwareSigner } from "./serial.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const MODE = (process.env.DEVICE_MODE ?? "simulator").toLowerCase();
const PORT = Number(process.env.BRIDGE_HTTP_PORT ?? "8787");
const SERIAL_PORT = process.env.BRIDGE_SERIAL_PORT ?? "COM3";

const signer: DeviceSigner =
  MODE === "hardware" ? new HardwareSigner(SERIAL_PORT) : new SimulatorSigner();

const app = Fastify({ logger: true });
await app.register(websocket);

// Connected dashboard sockets — broadcast device-state events (SPEC §5.2, §5.14).
const sockets = new Set<{ send: (data: string) => void }>();
function broadcast(event: string, data: Record<string, unknown> = {}): void {
  const msg = JSON.stringify({ event, ...data, ts: new Date().toISOString() });
  for (const s of sockets) {
    try {
      s.send(msg);
    } catch {
      /* drop dead socket on next gc */
    }
  }
}

app.get("/ws", { websocket: true }, (socket) => {
  sockets.add(socket as never);
  socket.send(JSON.stringify({ event: "device_connected", mode: MODE, simulated: signer.simulated }));
  socket.on("close", () => sockets.delete(socket as never));
});

app.get("/device/info", async () => {
  const info = await signer.getInfo();
  broadcast("device_connected", { ...info, mode: MODE });
  return info;
});

app.post("/device/sign", async (req, reply) => {
  const parsed = SignRequest.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "invalid SignRequest", issues: parsed.error.issues });
  }
  const signReq = parsed.data;
  try {
    const res = await signer.sign(signReq, () =>
      broadcast("awaiting_confirmation", { request_id: signReq.request_id, display: signReq.display }),
    );
    broadcast(res.outcome === "SIGNED" ? "approved" : res.outcome === "REJECTED" ? "rejected" : "timeout", {
      request_id: signReq.request_id,
    });
    return res;
  } catch (err) {
    app.log.error({ err }, "sign failed");
    broadcast("rejected", { request_id: signReq.request_id, error: String(err) });
    return reply.status(500).send({ error: String(err) });
  }
});

const info = await signer.getInfo().catch((e) => {
  app.log.error({ err: e }, "device getInfo failed at boot");
  return null;
});
app.log.info({ mode: MODE, simulated: signer.simulated, pubkey: info?.pubkey }, "bridge device ready");

await app.listen({ port: PORT, host: "0.0.0.0" });
