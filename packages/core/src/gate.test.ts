import { describe, expect, it } from "vitest";
import type { GateInput, GateOutcome, MatchedRule, PolicyConfig } from "@fx/shared";
import { evaluateGate } from "./gate.js";
import { decideGate } from "./gate-decision.js";

/**
 * Table-driven Policy Gate tests (SPEC §5.7 acceptance): every rule + boundaries,
 * 100% branch coverage, plus the I3 replay property (same input -> same decision).
 */

const policy: PolicyConfig = {
  version: "test-1",
  auto_max_rlusd: 250,
  risk_veto_threshold: 0.7,
  slippage_tolerance: 0.05,
  uncredentialed_action: "VETO",
  hot_float_cap_rlusd: 500,
};

/** A baseline input that passes every rule -> AUTO. Cases override fragments. */
function baseInput(): GateInput {
  return {
    intent: {
      id: "01TESTINTENT0000000000000000",
      source: "manual",
      created_by: "human:test",
      beneficiary: { name: "Test GmbH", address: "rDESTINATION0000000000000000000" },
      amount: { value: 100, currency: "RLUSD" },
      purpose: "invoice 42",
      corridor: "CH-EU",
      status: "pending",
      created_at: "2026-06-12T00:00:00.000Z",
    },
    amount_rlusd_eq: 100,
    compliance: {
      sanctioned: false,
      credential_found: true,
      credential_accepted: true,
      sources: ["sanctions:test", "ledger:credential"],
      degraded: false,
      checked_at: "2026-06-12T00:00:01.000Z",
    },
    risk: {
      score: 0.2,
      model_version: "heuristic-test",
      shap: [],
      degraded: false,
      checked_at: "2026-06-12T00:00:01.000Z",
    },
    route: {
      paths: [{ steps: [{ currency: "XRP" }] }],
      quoted_cost: 100,
      send_max: 105,
      slippage_tolerance: 0.05,
      no_route: false,
      degraded: false,
      checked_at: "2026-06-12T00:00:01.000Z",
    },
    hot_float_headroom_rlusd: 400,
    policy,
  };
}

type Patch = (i: GateInput) => void;
interface Case {
  name: string;
  patch: Patch;
  outcome: GateOutcome;
  rule: MatchedRule;
}

const cases: Case[] = [
  // Rule 1 — sanctioned -> BLOCK, and it wins over everything else.
  {
    name: "sanctioned -> BLOCK",
    patch: (i) => (i.compliance.sanctioned = true),
    outcome: "BLOCK",
    rule: "sanctioned",
  },
  {
    name: "sanctioned wins over degraded + risk + no_route",
    patch: (i) => {
      i.compliance.sanctioned = true;
      i.compliance.degraded = true;
      i.risk.score = 0.99;
      i.route.no_route = true;
    },
    outcome: "BLOCK",
    rule: "sanctioned",
  },
  // Rule 1b — compliance service failure -> forced BLOCK (fail-closed, SPEC §5.3).
  {
    name: "compliance degraded -> BLOCK",
    patch: (i) => (i.compliance.degraded = true),
    outcome: "BLOCK",
    rule: "compliance_degraded",
  },
  // Rule 2 — uncredentialed -> VETO (default) or BLOCK (escalated).
  {
    name: "credential not accepted -> VETO",
    patch: (i) => (i.compliance.credential_accepted = false),
    outcome: "VETO",
    rule: "uncredentialed",
  },
  {
    name: "credential missing entirely -> VETO",
    patch: (i) => {
      i.compliance.credential_found = false;
      i.compliance.credential_accepted = false;
    },
    outcome: "VETO",
    rule: "uncredentialed",
  },
  {
    name: "uncredentialed escalates to BLOCK when policy says so",
    patch: (i) => {
      i.compliance.credential_accepted = false;
      i.policy = { ...policy, uncredentialed_action: "BLOCK" };
    },
    outcome: "BLOCK",
    rule: "uncredentialed",
  },
  // Rule 3 — routing failures -> VETO.
  {
    name: "no_route -> VETO",
    patch: (i) => (i.route.no_route = true),
    outcome: "VETO",
    rule: "no_route_or_slippage",
  },
  {
    name: "routing degraded -> VETO",
    patch: (i) => (i.route.degraded = true),
    outcome: "VETO",
    rule: "no_route_or_slippage",
  },
  {
    name: "quote slippage looser than policy -> VETO",
    patch: (i) => (i.route.slippage_tolerance = 0.0501),
    outcome: "VETO",
    rule: "no_route_or_slippage",
  },
  {
    name: "boundary: slippage exactly at tolerance passes",
    patch: (i) => (i.route.slippage_tolerance = 0.05),
    outcome: "AUTO",
    rule: "auto",
  },
  // Rule 4 — risk -> VETO.
  {
    name: "risk degraded -> VETO (fail-closed 0.99 upstream)",
    patch: (i) => {
      i.risk.degraded = true;
      i.risk.score = 0.99;
    },
    outcome: "VETO",
    rule: "risk",
  },
  {
    name: "risk score above threshold -> VETO",
    patch: (i) => (i.risk.score = 0.71),
    outcome: "VETO",
    rule: "risk",
  },
  {
    name: "boundary: score exactly at threshold -> VETO (>= per SPEC)",
    patch: (i) => (i.risk.score = 0.7),
    outcome: "VETO",
    rule: "risk",
  },
  {
    name: "boundary: score just below threshold passes",
    patch: (i) => (i.risk.score = 0.6999),
    outcome: "AUTO",
    rule: "auto",
  },
  // Rule 5 — over AUTO ceiling -> VETO.
  {
    name: "amount above auto_max -> VETO",
    patch: (i) => (i.amount_rlusd_eq = 250.01),
    outcome: "VETO",
    rule: "over_auto_max",
  },
  {
    name: "boundary: amount exactly auto_max passes rule 5",
    patch: (i) => (i.amount_rlusd_eq = 250),
    outcome: "AUTO",
    rule: "auto",
  },
  // Rule 6 — over float headroom -> VETO (I5).
  {
    name: "amount above float headroom -> VETO",
    patch: (i) => {
      i.amount_rlusd_eq = 200;
      i.hot_float_headroom_rlusd = 199.99;
    },
    outcome: "VETO",
    rule: "over_float_headroom",
  },
  {
    name: "boundary: amount exactly headroom passes",
    patch: (i) => {
      i.amount_rlusd_eq = 200;
      i.hot_float_headroom_rlusd = 200;
    },
    outcome: "AUTO",
    rule: "auto",
  },
  {
    name: "zero headroom blocks any positive amount from AUTO",
    patch: (i) => {
      i.amount_rlusd_eq = 0.01;
      i.hot_float_headroom_rlusd = 0;
    },
    outcome: "VETO",
    rule: "over_float_headroom",
  },
  // Rule 7 — everything clean -> AUTO.
  { name: "clean baseline -> AUTO", patch: () => {}, outcome: "AUTO", rule: "auto" },
];

describe("Policy Gate (SPEC §5.7) — table-driven", () => {
  for (const c of cases) {
    it(c.name, () => {
      const input = baseInput();
      c.patch(input);
      const r = evaluateGate(input);
      expect(r.outcome).toBe(c.outcome);
      expect(r.matched_rule).toBe(c.rule);
      expect(r.config_version).toBe(input.policy.version);
    });
  }
});

describe("Policy Gate — I3 replayability", () => {
  it("identical input -> identical decision, including input_hash", () => {
    const a = decideGate(baseInput());
    const b = decideGate(baseInput());
    expect(a).toEqual(b);
    expect(a.input_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("any input change changes the input_hash", () => {
    const a = decideGate(baseInput());
    const mutated = baseInput();
    mutated.amount_rlusd_eq = 100.000001;
    const b = decideGate(mutated);
    expect(a.input_hash).not.toBe(b.input_hash);
  });

  it("gate module has no runtime imports (I3 lint check)", async () => {
    // gate.ts must be importable with zero side effects and contain no runtime deps.
    const fs = await import("node:fs");
    const url = new URL("./gate.ts", import.meta.url);
    const src = fs.readFileSync(url, "utf8");
    const runtimeImports = [...src.matchAll(/^import\s+(?!type\s)/gm)];
    expect(runtimeImports).toHaveLength(0);
  });
});
