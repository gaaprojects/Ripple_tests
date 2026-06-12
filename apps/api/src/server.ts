import Fastify from "fastify";
import cors from "@fastify/cors";
import { ulid } from "ulid";
import { z } from "zod";
import {
  config,
  loadPolicy,
  amendmentEnabled,
  verifyChain,
  auditTrail,
  recentAudit,
  runPipeline,
  approveVeto,
  rejectVeto,
  getTreasuryState,
  eudIssuerAddress,
  hotWallet,
  listPipelineRecords,
  getPipelineRecord,
  listQueueItems,
  getQueueItem,
  loadSanctions,
  fxBus,
  type FxEvent,
} from "@fx/core";
import { Money, Beneficiary, IntentSource, type PaymentIntent } from "@fx/shared";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true }); // demo: dashboard runs on another port

let credentialsAmendment = { name: "Credentials", enabled: false, checked: false };

/** Boot check (SPEC §5.1): XLS-70 Credentials amendment + sanctions list version log. */
async function bootChecks(): Promise<void> {
  try {
    const s = await amendmentEnabled("Credentials");
    credentialsAmendment = { ...s, checked: true };
    app.log.info({ credentialsAmendment }, "amendment boot check");
  } catch (err) {
    app.log.warn({ err }, "amendment boot check failed (degrading)");
  }
  try {
    app.log.info({ sanctions_version: loadSanctions().version }, "sanctions list loaded");
  } catch (err) {
    app.log.warn({ err }, "sanctions list failed to load (compliance will degrade -> BLOCK)");
  }
}

app.get("/health", async () => {
  const policy = loadPolicy();
  const chain = verifyChain();
  return {
    ok: true,
    network: config.wssUrl,
    policy_version: policy.version,
    amendments: { credentials: credentialsAmendment },
    audit_chain: chain,
  };
});

// --- intents -----------------------------------------------------------------

/** Wire shape for creating an intent. Schema-validated; invalid = rejected, never coerced. */
const CreateIntent = z.object({
  beneficiary: Beneficiary,
  amount: Money,
  purpose: z.string().default(""),
  corridor: z.string().optional(),
  source: IntentSource.default("manual"),
  created_by: z.string().default("human:dashboard"),
});

// One intent at a time keeps Sequence handling + float accounting simple for the demo.
let pipelineBusy: Promise<unknown> = Promise.resolve();

app.post("/intents", async (req, reply) => {
  const parsed = CreateIntent.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "invalid intent", issues: parsed.error.issues });
  }
  const b = parsed.data;
  const intent: PaymentIntent = {
    id: ulid(),
    source: b.source,
    created_by: b.created_by,
    beneficiary: b.beneficiary,
    amount: b.amount,
    purpose: b.purpose,
    corridor: b.corridor,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  const run = pipelineBusy.then(() => runPipeline(intent));
  pipelineBusy = run.catch(() => undefined);
  const record = await run;
  return reply.status(201).send(record);
});

app.get("/intents", async () => listPipelineRecords(200));

app.get("/intents/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const record = getPipelineRecord(id);
  if (!record) return reply.status(404).send({ error: "not found" });
  return { record, queue_item: getQueueItem(id), audit: auditTrail(id) };
});

// --- VETO approval queue (SPEC §5.9) ------------------------------------------

app.get("/queue", async () => listQueueItems());

app.post("/queue/:id/approve", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { approver?: string };
  try {
    const run = pipelineBusy.then(() => approveVeto(id, body.approver ?? "human:dashboard"));
    pipelineBusy = run.catch(() => undefined);
    return await run;
  } catch (err) {
    return reply.status(409).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/queue/:id/reject", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { who?: string; reason?: string };
  try {
    return rejectVeto(id, body.who ?? "human:dashboard", body.reason);
  } catch (err) {
    return reply.status(409).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- treasury / audit ----------------------------------------------------------

app.get("/treasury", async () => getTreasuryState(eudIssuerAddress()));

app.get("/audit", async (req) => {
  const { intent_id } = req.query as { intent_id?: string };
  const chain = verifyChain();
  if (intent_id) return { chain, records: auditTrail(intent_id) };
  return { chain, records: recentAudit(80) };
});

app.get("/policy", async () => loadPolicy());

/** Demo counterparty roster so the dashboard can prefill the three scripted scenarios. */
app.get("/counterparties", async () => ({
  ok: { label: "COUNTERPARTY_OK (credentialed)", address: process.env.COUNTERPARTY_OK_ADDRESS ?? "" },
  // hotWallet() derives lazily from HOT_SEED; counterparties are plain env addresses.
  fresh: { label: "COUNTERPARTY_NEW (no credential)", address: process.env.COUNTERPARTY_NEW_ADDRESS ?? "" },
  sanctioned: {
    label: "COUNTERPARTY_SANCTIONED (synthetic list)",
    address: process.env.COUNTERPARTY_SANCTIONED_ADDRESS ?? "",
  },
  hot: { label: "HOT account (float refill)", address: hotWallet().address },
  cold: { label: "COLD treasury", address: process.env.COLD_TREASURY_ADDRESS ?? "" },
}));

// --- live feed (SSE) ------------------------------------------------------------

app.get("/events", (req, reply) => {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  reply.raw.write(`data: ${JSON.stringify({ type: "connected", ts: new Date().toISOString() })}\n\n`);
  const onEvent = (ev: FxEvent) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
  fxBus.on("fx", onEvent);
  const keepalive = setInterval(() => reply.raw.write(": keepalive\n\n"), 15_000);
  req.raw.on("close", () => {
    clearInterval(keepalive);
    fxBus.off("fx", onEvent);
  });
});

const start = async () => {
  await bootChecks();
  await app.listen({ port: config.apiPort, host: "0.0.0.0" });
};

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
