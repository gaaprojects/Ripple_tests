import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { GateInput, GateDecision } from "@fx/shared";
import { decideGate } from "./gate-decision.js";

/**
 * Golden-file replay (SPEC §5.3 acceptance): the committed GateInput snapshots must decide
 * to EXACTLY the committed GateDecision — outcome, rule, config version AND input hash.
 * If this test fails after a gate change, the gate's behavior changed: that is a policy
 * change and must be deliberate (bump policy version + regenerate fixtures in the same PR).
 */
const fixtures = JSON.parse(
  readFileSync(new URL("./__fixtures__/golden-gate.json", import.meta.url), "utf8"),
) as Record<string, { input: unknown; expected: unknown }>;

describe("Pipeline replay — golden files", () => {
  for (const [name, { input, expected }] of Object.entries(fixtures)) {
    it(`replays "${name}" to the identical decision`, () => {
      const gateInput = GateInput.parse(input); // fixture must satisfy the live schema
      const decision = decideGate(gateInput);
      expect(decision).toEqual(GateDecision.parse(expected));
    });
  }
});

/**
 * SPEC §5.3 acceptance: killing the risk service yields degraded-VETO — never a crash.
 * The client substitutes score 0.99 / degraded:true, which the gate maps to VETO ("risk").
 */
describe("Risk client — fail-closed (SPEC §5.3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("unreachable risk service -> degraded 0.99, gate would VETO", async () => {
    vi.stubEnv("RISK_SERVICE_URL", "http://127.0.0.1:1"); // nothing listens here
    vi.resetModules();
    const { scoreRisk } = await import("./risk-client.js");
    const res = await scoreRisk({
      intent_id: "01TEST",
      amount_rlusd_eq: 50,
      corridor: "CH-EU",
      new_counterparty: false,
      velocity_1h: 0,
      velocity_24h: 0,
      hour_of_day: 12,
      amount_to_float_ratio: 0.1,
    });
    expect(res.degraded).toBe(true);
    expect(res.score).toBe(0.99);
  });
});
