# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`fx-sentinel` — a compliance-gated FX treasury agent on XRPL **Testnet** (SwissHacks 2026,
Ripple "Future of Finance" challenge, AI Agents for Finance track). The thesis: **structurally
separate AI intelligence from signing authority**. LLMs read and explain; a pure-function
**Policy Gate** routes every payment to `AUTO` (hot key, capped float), `VETO` (signed only by
a physical button press on a Firefly Pixie holding the cold key), or `BLOCK` (hard stop).

**`SPEC.md` is the single binding source of truth.** Read the relevant tagged section in full
before touching a subsystem. This file is the operating-rules summary; `SPEC.md` is authoritative
on any conflict.

## Non-negotiable invariants (assert in code AND tests)

- **I1** — No LLM output ever feeds a signing operation or a Policy Gate decision branch. LLM
  output goes only to display/narrative fields and schema-validated, human-confirmable drafts.
- **I2** — The cold treasury `RegularKey` private key exists ONLY on the Firefly device (or the
  labeled simulator keyfile). Never in `apps/api`, never in software on the server.
- **I3** — The Policy Gate is a pure, replayable function: identical `GateInput` → identical
  `GateDecision`. No I/O, no clock, no randomness inside. Thresholds arrive as input from
  versioned `ops/config/policy.yaml`. (Lint/review: the gate imports no I/O, time, or RNG.)
- **I4** — Every state transition is an append-only audit record (hash-chained). Every ledger
  mutation writes an audit record BEFORE and AFTER submission. No exceptions.
- **I5** — Hot-account float is capped; the gate refuses `AUTO` above remaining headroom.

## Rules of engagement (SPEC §0.3 — binding)

1. **MCP-first.** Training data on XRPL is stale. Before coding against any XRPL feature,
   amendment, issuer address, or SDK call signature, verify via the **xrpl.org MCP** (or
   context7 for SDK docs) — never from memory. **Never hardcode an issuer address** (especially
   RLUSD) from training data or code comments. RLUSD Testnet issuer is `VERIFY_AT_BUILD`.
2. **Never hand-roll XRPL serialization or signing hashes.** Use `xrpl.js` /
   `ripple-binary-codec` (`encodeForSigning`, `encode`, address codec). The only crypto outside
   the SDK is the secp256k1 signature produced on the Firefly device. Local-verify any signature
   with the SDK before submit; normalize to canonical low-S.
3. **Secrets** live in `.env` (gitignored) only — never printed, logged, or committed.
   `COLD_TREASURY` is stored as an **address only**; never store its seed.
4. **Non-goals (SPEC §10) are binding** — no Vaults/Lending/Permissioned-DEX, no MPTokens, no
   on-device XRPL deserialization (MVP), no partial payments ever, no real sanctions/PII/mainnet
   funds. If a task seems to need an out-of-scope feature, stop and flag.
5. **Policy Gate changes ship with table-driven tests in the same change.** Never weaken I1–I5
   for demo convenience. Prefer boring reliability — this runs on stage Wi-Fi.
6. Acceptance checklists in each `SPEC.md` subsystem section are the definition of done.

## Architecture (the big picture — see SPEC §3, §5)

Flow per `PaymentIntent`: **AI Intake** (LLM draft, human-confirmed) → **Pipeline Controller**
(deterministic orchestrator, *not* an agent loop) runs **Compliance**, **Risk (ML+SHAP)**, and
**Routing** in parallel → assembles `GateInput` → **Policy Gate** (pure fn) → dispatch to AUTO
executor / VETO approval queue / BLOCK → audit at every step.

- **AI is always outside the gate-critical path.** Adapters have timeout + JSON-schema validation
  + one retry + a deterministic fallback. The pipeline never blocks on an LLM.
- **Fail-closed defaults:** Compliance fail → forced `BLOCK`; Risk fail → score `0.99` flagged
  `degraded` (→ VETO); Routing fail → `VETO` with no-route flag.
- **VETO signing happens at approval time, not queue time** (txns expire during human review):
  at queue time persist intent+decision+route snapshot; at approval fetch fresh `Sequence`, set
  `LastLedgerSequence ≈ current+40`, build unsigned tx, send digest to device.
- **Treasury Agent (autonomous):** its ONLY actuator is `POST /intents`. It has goals and
  deterministic trigger thresholds but no signing capability and no executor access.

### Layer tags
Every subsystem is tagged: `[HW]` `[XRPL]` `[AI]` `[FN]` `[DATA]` `[UI]`. Read the tagged
`SPEC.md` section before touching that layer.

### Planned monorepo layout (SPEC §4)
`apps/api` (Fastify TS + zod: pipeline, compliance, routing, gate, executors, queue, agent,
audit) · `apps/web` (Next.js dashboard) · `apps/bridge` (USB-serial ⇄ HTTP/WS device daemon +
simulator) · `services/risk` (Python FastAPI: training, registry, `/score` + SHAP) ·
`packages/shared` (zod schemas + TS types, SPEC §6 — mirrored as pydantic in `services/risk`) ·
`firmware/` (Pixie ESP-IDF C) · `ops/provisioning` (one-time setup CLIs) · `ops/config`
(`policy.yaml`, `corridors.yaml`) · `vendor/firefly/` (cloned, gitignored).

Grows from the team baseline [`tlukanie/Ripple_tests`](https://github.com/tlukanie/Ripple_tests)
(Node + xrpl.js, `fund-wallet.js`, `send-payment.js`, `.env` discipline, explorer =
`testnet.xrpl.org`). Those two scripts become smoke-test utilities under `ops/provisioning/`.

## Device modes (SPEC D12 — mandatory fallback)

`DEVICE_MODE=hardware|simulator`. The simulator is a software signer with an **identical bridge
API** plus a loud "SIMULATED DEVICE" badge in the UI. Flipping the mode must require **zero code
changes elsewhere**. Always build/keep the simulator working — never demo without a fallback.

## Tooling setup (SPEC §0.1 — do before XRPL coding)

- xrpl.org MCP: `claude mcp add --transport http xrpl-org https://xrpl.org/mcp`
- context7 MCP (SDK docs) — already connected; needs `CONTEXT7_API_KEY` if quota is hit.
- XRPL Development Skill: install from `XRPL-Commons/xrpl-dev-skills` into `.claude/skills/`.
- Vendor Firefly source into `vendor/firefly/` (gitignored): `firefly/pixie-firmware`,
  `firefly/pixie-repl` (protocol seed for the bridge).
- MCP-down fallback at the venue: `https://xrpl.org/llms.txt` (every xrpl.org doc also serves a
  raw `.md` via the Copy dropdown / append `.md`).

## Commands

Toolchain present: Node v22, pnpm 11, Python 3.12, git. **The monorepo is not scaffolded yet**
(repo currently holds `SPEC.md` only). Once scaffolded per the build plan, the intended scripts are:

- `pnpm install` — install workspace deps
- `pnpm dev` — boot `apps/api` + `apps/bridge` (DEVICE_MODE=simulator) + `apps/web`
- `pnpm dev:risk` — run the Python `services/risk` FastAPI service
- `pnpm -r build` — build all workspaces; `packages/shared` builds first (others import it)
- `pnpm test` — run tests; Policy Gate must have table-driven, 100%-branch coverage
- `ops/provisioning/*` — idempotent CLIs: fund accounts → DefaultRipple → trustlines → mint EUD
  → create AMMs → read device pubkey → `SetRegularKey` on COLD_TREASURY → issue credentials →
  smoke-test one payment per path

Verify on the explorer at `https://testnet.xrpl.org`.

## Build phases (SPEC §8)

P0 Foundations → P1 XRPL core (first AUTO payment) → P2 Pipeline+Gate → P3 Real services
(Risk ML, Compliance) → P4 VETO+hardware signing → P5 AI+agent+polish. **Never cut:** policy
gate tests, the VETO hardware path, the simulator fallback.
