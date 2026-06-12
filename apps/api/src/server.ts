import Fastify from "fastify";
import { config, loadPolicy, amendmentEnabled, verifyChain } from "@fx/core";

const app = Fastify({ logger: true });

let credentialsAmendment = { name: "Credentials", enabled: false, checked: false };

/**
 * Boot check (SPEC §5.1): query the node `feature` table for XLS-70 Credentials.
 * Result is logged and exposed in /health; compliance degrades per D1 if absent.
 */
async function bootChecks(): Promise<void> {
  try {
    const s = await amendmentEnabled("Credentials");
    credentialsAmendment = { ...s, checked: true };
    app.log.info({ credentialsAmendment }, "amendment boot check");
  } catch (err) {
    app.log.warn({ err }, "amendment boot check failed (degrading)");
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

const start = async () => {
  await bootChecks();
  await app.listen({ port: config.apiPort, host: "0.0.0.0" });
};

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
