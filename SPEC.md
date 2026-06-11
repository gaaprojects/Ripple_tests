# SPEC — Compliance-Gated FX Treasury Agent on XRPL

**Event:** SwissHacks 2026 · Zurich · June 19–21
**Challenge:** Ripple — *Future of Finance on XRPL* · Track: **AI Agents for Finance** (overlap: Cross-Border Payments & FX)
**Network:** XRPL **Testnet** (D1; the brief allows Devnet or Testnet)
**Codename:** `fx-sentinel`
**Team baseline repo:** [`tlukanie/Ripple_tests`](https://github.com/tlukanie/Ripple_tests) (see 0.2)

---

## 0. Claude Code — read this first

### 0.1 Tooling setup (do BEFORE writing any XRPL code)

Training data on XRPL is stale by definition. Use these (all verified June 2026, per [xrpl.org AI Tools](https://xrpl.org/resources/dev-tools/ai-tools)):

| Tool | What | Setup |
|---|---|---|
| **xrpl.org MCP server** | Official docs: concepts, tx reference, amendments | `claude mcp add --transport http xrpl-org https://xrpl.org/mcp` |
| **Context7 MCP** | xrpl.js / xrpl-py / xrpl-go SDKs, xrpl.org, opensource.ripple.com (in-development features) | `claude mcp add context7 -- npx -y @upstash/context7-mcp --api-key <KEY>` — get a free key at context7.com; free quota exhausts fast, create the key day 0 |
| **XRPL Development Skill** | Claude Code skill (progressive disclosure): tx forming, security, token issuance | Install per README: [`XRPL-Commons/xrpl-dev-skills`](https://github.com/XRPL-Commons/xrpl-dev-skills) → `.claude/skills/` |
| **llms.txt fallback** | If MCP is down at the venue | Fetch `https://xrpl.org/llms.txt`; every xrpl.org doc page also serves a raw `.md` version (Copy dropdown / append `.md`) |
| **Firefly sources** | No official Firefly MCP exists. Vendor the source so Claude Code reads it directly | `git clone` into `vendor/firefly/` (gitignored): [`firefly/pixie-firmware`](https://github.com/firefly/pixie-firmware), [`firefly/pixie-repl`](https://github.com/firefly/pixie-repl); add `component-hollows` only if needed |

**MCP-first rule:** before coding against any XRPL feature, amendment, issuer address, or SDK call signature — verify via MCP, never memory. Never hardcode an issuer address from training data.

### 0.2 Repo baseline

`tlukanie/Ripple_tests` is the team's validated Testnet starting point: Node.js + xrpl.js, `fund-wallet.js` (faucet → `.env`), `send-payment.js` (XRP payment), `.env.example` pattern, explorer = `testnet.xrpl.org`. The xrpl.org MCP is already proven against it (via Cursor).

**Action:** grow the monorepo (Section 4) from this repo (or a fresh repo with it absorbed). The two scripts become smoke-test utilities under `ops/provisioning/`. Keep its `.env` discipline.

### 0.3 Rules of engagement

1. **Layer tags:** every subsystem is `[HW]` `[XRPL]` `[AI]` `[FN]` `[DATA]` `[UI]`. Read the tagged section in full before touching it.
2. **Never hand-roll XRPL serialization or signing hashes.** Use `xrpl.js` / `ripple-binary-codec` (`encodeForSigning`, `encode`, address codec). The only crypto outside the SDK is the secp256k1 signature produced **on the Firefly device**.
3. **Secrets:** seeds live in `.env` (gitignored) only; never printed, logged, or committed. The cold key never exists in software — only inside the Firefly (or the labeled simulator).
4. **Every ledger mutation writes an audit record** (5.13) before and after submission. No exceptions.
5. **Non-goals (Section 11) are binding.** If a task seems to need an out-of-scope feature, stop and flag.
6. **Acceptance checklists are the definition of done.**
7. Policy Gate changes ship with table-driven tests in the same PR. Never weaken invariants I1–I5 for demo convenience. Prefer boring reliability — this runs on stage Wi-Fi.

---

## 1. Challenge brief & judging alignment

**Official brief (Challenge 1):** Build an institutional DeFi prototype on XRPL Devnet or Testnet across one or more of three tracks — cross-border payments & FX, credit & lending, or **AI agents for finance**. Fix the slow, costly plumbing of institutional finance using XRPL primitives such as the Lending Protocol (XLS-66), Single Asset Vaults (XLS-65), MPTokens, TokenEscrow, and RLUSD. Solutions should hit a real institutional pain point and show a believable path to mainnet. **Judging: viability & feasibility 40% · technical use of XRPL features 25%** · remainder innovation/demo/etc.

**Our pain point:** institutional treasury/FX is slow and operationally risky, and AI-agent automation raises the adoption-blocking question for any regulated institution: *who holds the keys when the agent acts?* This prototype structurally separates intelligence from authority:

- **LLMs read and explain — never decide, never sign** (I1).
- A pure-function **Policy Gate** routes every payment intent: `AUTO` (small/low-risk → hot account, capped float) · `VETO` (held → signed only by a physical button press on a Firefly Pixie holding the cold treasury key) · `BLOCK` (hard stop).
- Both authorized paths settle on XRPL in ~4 s.
---

## 2. Decisions log (binding)

| # | Decision | Choice | Rationale / trade-off |
|---|---|---|---|
| D1 | Network | **Testnet** | Official Ripple Testnet RLUSD issuer; team repo already targets Testnet; faucet + explorer reliability. ⚠️ **P0 check:** query `feature` for XLS-70 Credentials amendment on Testnet; if absent, compliance falls back to off-ledger-only and the credential demo moves to Devnet as an isolated side-show. |
| D2 | Firefly signing path | **Extended `pixie-repl`-style firmware command signing a 32-byte digest; host-supplied display fields rendered on-device; transport = Node "device bridge" daemon over USB serial** | Full on-device XRPL parsing is out of 48 h scope. Device shows destination/amount/currency/purpose + requires physical button. Known limitation (Section 12): display fields are host-supplied, not digest-derived. WebSerial rejected (Chromium-only, flaky on stage). |
| D3 | Cold key model | **Device key = `RegularKey` on treasury account; master key offline** (would be disabled on mainnet) | Same single-sig signing-hash as master key, plus rotation/recovery story, plus hardware-failure escape hatch. `SignerList` multisig rejected: different signing-hash serialization, more failure modes. |
| D4 | FX pair | **RLUSD → project-issued `EUD` ("demo EUR") via XRP auto-bridging through two project-seeded AMMs (RLUSD/XRP, XRP/EUD)** | Genuine `path_find` exercise; own pools = deterministic demo liquidity. Trustline IOU over MPToken deliberately (no DEX/AMM pathfinding for MPTs). |
| D5 | Credentials & Escrow | **XLS-70 Credentials IN; TokenEscrow OUT of MVP → stretch S3** | Credentials lift the on-ledger compliance story cheaply. Escrow cut to protect the core demo. |
| D6 | Risk model | **Real fitted gradient-boosted trees (sklearn `HistGradientBoostingClassifier` / XGBoost) on synthetic treasury data; SHAP `TreeExplainer`; Python FastAPI microservice** | SHAP must come from a real model or ML-literate judges dismantle it. |
| D7 | LLM provider | **Anthropic API (Claude Sonnet) behind a thin adapter**: timeout, JSON-schema validation + one retry, deterministic fallback per use | AI is non-blocking by construction. |
| D8 | Agentic layer | **YES — scheduled autonomous Treasury Agent** monitoring hot-float & FX exposure, *generating* PaymentIntents into the same governed pipeline | Makes the track fit literal: the agent has goals and tools, but its only actuator is intent submission. Carries the closing narrative. |
| D9 | Stack | **pnpm monorepo:** `apps/api` (Fastify TS + zod) · `apps/web` (Next.js) · `apps/bridge` (device daemon) · `services/risk` (Python FastAPI) · `packages/shared`. **SQLite** | Matches team xrpl.js baseline + Antonio's stack. SQLite = zero-ops demo; Postgres = mainnet path. |
| D10 | Team lanes | **A:** XRPL core · **B:** Hardware · **C:** Pipeline/Risk/Agent · **D:** Dashboard. Contracts in Section 6 let lanes run parallel | Lane B starts day 0 — longest uncertainty tail. |
| D11 | Spec format | **This single `SPEC.md`** | One artifact for Claude Code. Split into `CLAUDE.md` later if needed. |
| D12 | Demo fallback | **Mandatory `DEVICE_MODE=hardware\|simulator`.** Simulator = software signer with identical bridge API + loud "SIMULATED DEVICE" UI badge | Never demo without a fallback; the architecture narrative survives because the interface is identical. |

---

## 3. System overview & invariants

```
SERVER ZONE
  Intent sources (email/invoice, manual, Treasury Agent)
  [AI] AI Intake ──► [FN] Pipeline Controller ──► [AI] AI Explainer (read-only)
                          │
        ┌─────────────────┼──────────────────┐
   [XRPL] Compliance  [AI] Risk (ML+SHAP)  [XRPL] Routing (path_find/AMM)
        └─────────────────┼──────────────────┘
                  [FN] Policy Gate (pure fn)
              AUTO ◄──────┼──────► VETO          BLOCK ▼ (hard stop)
   [XRPL] Exec(Auto)              [XRPL] Exec(Veto: UNSIGNED tx)
   hot key, small float           Approval Queue
        │                              │
DATA: Audit Log · Model Registry   OPERATOR ZONE
Sanctions · ws client                [UI] Dashboard ◄► [HW] Bridge ◄► [HW] Firefly Pixie
        │                              │   (cold RegularKey exists ONLY on device)
        ▼                              ▼
              XRPL TESTNET · ~4 s settlement
```

**Invariants (assert in code and tests):**

- **I1** — No LLM output ever feeds a signing operation or a Policy Gate decision branch. LLM output goes only to display/narrative fields and the schema-validated, human-confirmable intent draft.
- **I2** — The cold treasury `RegularKey` private key exists only on the Firefly (or labeled simulator keyfile).
- **I3** — Policy Gate is pure & replayable: identical `GateInput` → identical `GateDecision`. No I/O, clock, or randomness inside; thresholds arrive as input from versioned config.
- **I4** — Every state transition is an append-only audit record.
- **I5** — Hot account float is capped; the gate receives live float and refuses AUTO above remaining headroom.

---

## 4. Repository layout

```
fx-sentinel/                  # grows from tlukanie/Ripple_tests (0.2)
  apps/
    api/          # Fastify TS: pipeline, compliance, routing, gate, executors, queue, agent, audit
    web/          # Next.js dashboard
    bridge/       # Device bridge daemon (USB serial ⇄ local HTTP/WS) + simulator
  services/risk/  # Python FastAPI: training, registry, /score + SHAP
  packages/shared/# zod schemas + TS types (Section 6)
  firmware/       # Pixie firmware extension (ESP-IDF, C) — Lane B
  vendor/firefly/ # cloned pixie-firmware, pixie-repl (gitignored) — per 0.1
  ops/
    provisioning/ # one-time setup CLIs (absorbs fund-wallet.js / send-payment.js)
    config/       # policy.yaml (versioned thresholds), corridors.yaml
  data/sanctions/ # demo sanctions list (JSON, clearly synthetic)
  SPEC.md
  .env.example    # every var from Section 7, no real values
```

---

## 5. Subsystem specs

### 5.1 `[XRPL]` Network, accounts & assets

**Accounts (Testnet, faucet-funded; addresses documented in `.env` + README):**

| Account | Keys | Purpose |
|---|---|---|
| `COLD_TREASURY` | Master generated at setup, stored offline; **RegularKey = Firefly device key** (D3) | Bulk RLUSD/XRP; source for VETO payments and hot refills |
| `HOT_ACCOUNT` | Server seed in `.env` | Small float (~500 RLUSD-eq); source for AUTO payments |
| `EUD_ISSUER` | Server seed | Issues `EUD` IOU; `DefaultRipple` enabled |
| `COMPLIANCE_ISSUER` | Server seed | Issues XLS-70 KYC credentials |
| `COUNTERPARTY_OK / _NEW / _SANCTIONED` | Faucet | Demo destinations: credentialed / uncredentialed / sanctions-listed |
| `OPS` | Server seed | Seeds AMMs, pays setup fees |

**Assets & liquidity:**
- RLUSD trustlines from treasury/hot/counterparties to the **official Ripple Testnet RLUSD issuer** — ⚠️ `VERIFY_AT_BUILD` via MCP (RLUSD docs); obtain from Ripple's RLUSD Testnet faucet. Never trust an address from code comments or training data.
- `EUD` trustlines everywhere relevant; issuer mints to `OPS` and counterparties.
- AMMs by `OPS`: **RLUSD/XRP** + **XRP/EUD**, sized so the demo trade (~1–5k RLUSD) moves price < 1%. `AMMCreate` burns incremental owner reserve — fund `OPS` generously.

**Provisioning (one-time, `ops/provisioning/`):** fund → `DefaultRipple` on issuers → trustlines → mint EUD → create AMMs → read device pubkey via bridge → derive classic address → `SetRegularKey` on `COLD_TREASURY` → issue credentials (5.4) → smoke-test one payment per path.

**Boot check:** query node `feature` for the Credentials amendment; log + expose in `/health`; degrade per D1.

**Acceptance:**
- [ ] Accounts funded, trustlines set, EUD minted, both AMMs live (explorer-verifiable).
- [ ] `account_info` on `COLD_TREASURY` shows RegularKey = device-derived address.
- [ ] Manual RLUSD→EUD cross-currency payment succeeds via path_find quote.
- [ ] Feature check runs at boot; result in logs and `/health`.

### 5.2 `[HW]` Firefly Pixie: firmware, bridge & simulator

**Hardware:** Firefly Pixie — ESP32-C3 (RISC-V, 400 KB RAM), 16 MB flash, 240×240 IPS, 4 buttons. Sources vendored per 0.1 (`pixie-firmware` C/ESP-IDF; `pixie-repl` = protocol seed).

**Firmware scope (Lane B):**
1. Generate/load secp256k1 keypair in device storage; `GET_INFO` returns compressed pubkey.
2. `SIGN_REQUEST`: receive 32-byte digest **+ display fields**; render destination (truncated), amount+currency, purpose, request ID; one button = APPROVE → **canonical low-S DER secp256k1 signature** over the digest; other = REJECT; timeout → rejection.
3. Nothing else. No on-device XRPL parsing in MVP (D2 — documented limitation).

**Signing-digest contract (host, `[XRPL]`):** build the full unsigned tx with `SigningPubKey` = device pubkey, `TxnSignature` absent; compute the single-sig signing payload via SDK `encodeForSigning` (`STX` prefix construction); hash per XRPL rules; send digest. On return: attach `TxnSignature`, encode, **local-verify with the SDK before submit**. ⚠️ **Low-S canonicality is a day-one verification item** — assert and normalize if needed.

**Bridge daemon (`apps/bridge`):** owns USB serial (JSON-lines). Local HTTP/WS API: `GET /device/info`, `POST /device/sign` (digest + display fields + timeout), WS events (`device_connected`, `awaiting_confirmation`, `approved`, `rejected`, `timeout`). `DEVICE_MODE=simulator`: identical API, local keyfile signer, 2 s artificial delay, `simulated: true` flag → loud dashboard badge (D12).

**Acceptance:**
- [ ] `GET /device/info` returns stable pubkey across reboots (hardware and simulator).
- [ ] `SIGN_REQUEST` renders correct fields on the physical display; APPROVE returns a signature `xrpl.js` verifies; REJECT/timeout propagate cleanly.
- [ ] Signed VETO tx submits `tesSUCCESS` — canonical signature proven end-to-end.
- [ ] Flipping `DEVICE_MODE` requires zero code changes elsewhere.

### 5.3 `[FN]` Pipeline Controller

Deterministic orchestrator — **not** an agent loop. Per `PaymentIntent`: persist → run Compliance/Risk/Routing in parallel (per-service timeout 3–5 s) → assemble `GateInput` → Policy Gate → dispatch (executor / queue / block) → audit at every step. **Failure handling:** Compliance fail → forced `BLOCK` (fail-closed); Risk fail → conservative score 0.99 flagged `degraded` (→ VETO in practice); Routing fail → `VETO` with no-route flag. AI adapters are outside the gate-critical path entirely.

**Acceptance:**
- [ ] Same intent + config + service results replays to same decision (golden-file test).
- [ ] Killing the risk service mid-run yields degraded-VETO — never a crash or AUTO.

### 5.4 `[XRPL]` Compliance Service

Two deterministic checks:
1. **Off-ledger sanctions screen:** exact + normalized match of destination address (and name if present) against `data/sanctions/` (synthetic).
2. **On-ledger XLS-70 credential:** `ledger_entry` lookup for a `KYC` credential issued by `COMPLIANCE_ISSUER` to the destination **and accepted** by the subject. Provisioning: `CredentialCreate` (issuer) + `CredentialAccept` (subject) for `COUNTERPARTY_OK` only.

Output: `ComplianceResult { sanctioned, credential_found, credential_accepted, checked_at, sources }`.
**Stretch S1:** `DepositAuth` + `DepositPreauth` keyed to the credential → the *ledger itself* rejects uncredentialed counterparties.

**Acceptance:**
- [ ] `COUNTERPARTY_SANCTIONED` → BLOCK; zero ledger submissions (negative test).
- [ ] `COUNTERPARTY_OK` credential visible on explorer; `COUNTERPARTY_NEW` → credential_found=false.

### 5.5 `[AI]` Risk Service (ML + SHAP) — `services/risk`

- **Synthetic data generator:** documented features — amount z-score vs counterparty history, corridor risk weight (`corridors.yaml`), tx velocity (1h/24h), new-counterparty flag, hour-of-day, amount-to-float ratio. Labels from a noisy generative rule. Persist dataset + seed.
- **Training (P3, offline):** gradient-boosted trees (D6); hold-out AUC; artifact → Model Registry `model_vN/` (model + `metadata.json`: time, data hash, AUC, features).
- **Inference:** `POST /score` → `RiskResult { score 0–1, model_version, shap: [{feature, value, contribution}], degraded: false }` via `TreeExplainer`.

**Acceptance:**
- [ ] Reproducible training from seed; AUC > 0.85 hold-out (sanity, not science).
- [ ] SHAP contributions + base value sum to model output within tolerance.
- [ ] Registry holds ≥1 versioned artifact; `/score` reports it.

### 5.6 `[XRPL]` Routing Service

For RLUSD → EUD/XRP intents: `path_find` / `ripple_path_find` from sender; capture best path(s) + quoted source cost; `SendMax = quote × (1 + slippage_tolerance)` (default 0.5%). **No partial payments, ever** — exact `Amount`, bounded `SendMax`, no `tfPartialPayment` (the partial-payment exploit class is precisely what a treasury must avoid — tell the judges). Output `RouteResult { paths, quoted_cost, send_max, slippage_tolerance, pool_snapshot, no_route? }`.

**Acceptance:**
- [ ] RLUSD→EUD quote routes via XRP auto-bridging through both seeded AMMs (path visible).
- [ ] Draining a pool in test yields no_route/excess-slippage → gate forces VETO.

### 5.7 `[FN]` Policy Gate

Pure function (I3): `gate(GateInput) → GateDecision`. Input = intent (amount normalized to RLUSD-eq, destination, corridor) + ComplianceResult + RiskResult + RouteResult + live hot-float headroom + `policy_config` (versioned `policy.yaml`).

Decision order (first match wins; tune at venue):
1. `sanctioned` → **BLOCK**
2. `credential_accepted == false` → **VETO** (config flag can escalate to BLOCK)
3. `no_route` or slippage beyond tolerance → **VETO**
4. `risk.degraded` or `score ≥ 0.70` → **VETO**
5. `amount > auto_max` (default 250 RLUSD-eq) → **VETO**
6. `amount > hot_float_headroom` → **VETO**
7. else → **AUTO**

Output includes `matched_rule`, input snapshot hash, config version — replayability *is* the audit story.

**Acceptance:**
- [ ] Table-driven tests cover every rule + boundaries; 100% branch coverage.
- [ ] Gate has zero imports of I/O, time, or RNG modules (lint/review check).

### 5.8 `[XRPL]` Execution — AUTO path

Build `Payment` from `HOT_ACCOUNT` (fields from `RouteResult`), sign with server key, submit-and-wait, record tx hash + result + explorer URL, update float. Reliable submission: fresh `Sequence`, `LastLedgerSequence = current + ~20`, idempotency via intent ID in a `Memo`.

**Acceptance:**
- [ ] AUTO settles `tesSUCCESS` < 10 s wall clock; dashboard shows validated state + explorer link.
- [ ] Float decrements; AUTO above headroom is impossible (gate test + executor assert).

### 5.9 `[XRPL]+[HW]` Execution — VETO path & Approval Queue

**Demo centerpiece. Critical gotcha:** a tx built at *queue* time expires during human review (`LastLedgerSequence` vs ~4 s ledgers). Therefore:

1. **Queue time:** persist `QueueItem` = intent + decision + route snapshot — **not** a finalized tx. State `pending`. Explainer narrative attaches asynchronously (5.11).
2. **Approval click:** *now* fetch fresh `Sequence`, set `LastLedgerSequence = current + ~40` (~2–3 min window), build unsigned `Payment` from `COLD_TREASURY` with `SigningPubKey` = device pubkey, compute digest (5.2), send `SIGN_REQUEST` + display fields. State `awaiting_device`.
3. **Device approve:** attach signature, local-verify, submit, await validation. `signed` → `settled` (+ tx hash, explorer URL). Device reject/timeout → `rejected` with full audit trail. Expired window → rebuild + re-request (one auto retry, then back to `pending`).

**Acceptance:**
- [ ] Full chain pending → awaiting_device → physical button → settled on hardware AND simulator.
- [ ] Lapsed signing window triggers the rebuild path, not a `tefMAX_LEDGER` dead-end.
- [ ] Dashboard reject and device reject both terminate cleanly with audit records.

### 5.10 `[AI]` AI Intake

LLM adapter: pasted email/invoice → `PaymentIntent` draft. Strict zod validation; one retry on invalid JSON; fallback = pre-filled manual form. Draft is **always confirmed by a human (or agent) before entering the pipeline** — intake never silently submits (I1). Demo input: supplier email in German or French (Swiss touch).

**Acceptance:**
- [ ] Sample email → valid schema → confirmation → pipeline. Garbage → fallback form, pipeline unaffected.

### 5.11 `[AI]` AI Explainer

Read-only LLM adapter. Input: audit bundle for one intent (service results, SHAP top-3, matched rule). Output: 3–5 sentence reviewer narrative. Attached async to the QueueItem; **deterministic template fallback** so the queue never waits. Prompt: explain only from provided fields; no approve/reject recommendations.

**Acceptance:**
- [ ] Queue functions identically with LLM disabled (template path).
- [ ] Narrative renders alongside raw SHAP + rule data — supplements, never replaces.

### 5.12 `[AI]` Treasury Agent (autonomous, D8)

Scheduled loop (e.g., 60 s in demo mode). Reads treasury state (hot float, RLUSD/EUD balances, exposure targets). Behaviors:
1. **Float replenishment:** float below threshold → refill `PaymentIntent` from `COLD_TREASURY` → `HOT_ACCOUNT`. By size lands in **VETO** — the agent autonomously asking the human + hardware for money is the closing beat.
2. **FX rebalance:** RLUSD excess vs EUD target → small conversion intent → lands in **AUTO**.

LLM may *summarize reasoning* for the dashboard journal; trigger conditions are deterministic thresholds (I1). The agent's **only actuator** is `POST /intents` — no signing capability, no executor access, rate-limited (max N intents/hour).

**Acceptance:**
- [ ] Draining float below threshold → agent enqueues refill intent into the VETO queue within one cycle.
- [ ] Journal shows reasoning; removing the LLM degrades the journal, never the behavior.

### 5.13 `[DATA]` Data tier (SQLite)

- **Audit log:** append-only; every event with timestamp, intent ID, actor (`system|agent|human:<id>|device`), payload snapshot, **hash chain** (each record stores previous hash — cheap tamper-evidence, good judging line).
- **Approval queue:** states per 5.9. · **Model registry:** per 5.5. · **Sanctions:** versioned JSON, version logged at boot. · **Float ledger:** spend tracking reconciled against ws-observed balances.

**Acceptance:**
- [ ] Any settled tx hash reconstructs the full path intent→decision→signature→validation.
- [ ] Hash-chain verification command passes; tampering with a row fails it.

### 5.14 `[UI]` Dashboard (`apps/web`)

Views: **Live pipeline feed** (color-coded AUTO/VETO/BLOCK) · **Approval queue** (intent, compliance, SHAP bars, route quote, narrative; Approve/Reject; live device-state from bridge WS — "Confirm on device…") · **Treasury** (balances, float gauge, agent journal) · **Audit explorer** (per-intent timeline + explorer links). Simulator badge per D12. Dense and operational (Bloomberg-ish), not marketing-glossy.

**Acceptance:**
- [ ] All six demo beats performable from the dashboard alone — no terminal visible.
- [ ] Device confirmation state updates < 1 s on physical button press.

---

## 6. Data contracts (`packages/shared`, zod — mirrored as pydantic in `services/risk`)

- **PaymentIntent:** `id (ulid)`, `source ("email"|"manual"|"agent")`, `created_by`, `beneficiary { name?, address }`, `amount { value, currency: "RLUSD"|"EUD"|"XRP" }`, `purpose`, `corridor?`, `status`, `created_at`.
- **ComplianceResult / RiskResult / RouteResult:** per 5.4/5.5/5.6, each with `degraded?: boolean`, `checked_at`.
- **GateInput / GateDecision:** per 5.7; decision = `{ outcome: "AUTO"|"VETO"|"BLOCK", matched_rule, config_version, input_hash }`.
- **QueueItem:** `intent_id`, `state: "pending"|"awaiting_device"|"signed"|"settled"|"rejected"|"expired"`, `narrative?`, `tx_hash?`, `explorer_url?`, transition timestamps.
- **Bridge protocol** (JSON-lines over serial; mirrored on local HTTP): `GET_INFO → { pubkey, fw_version }`; `SIGN_REQUEST { request_id, digest_hex, display: { destination, amount, currency, purpose } } → SIGN_RESPONSE { request_id, signature_der_hex } | REJECTED | TIMEOUT`.

All cross-service payloads validate at boundaries; invalid = rejected, never coerced.

---

## 7. Configuration

`.env.example` enumerates (no real values): `XRPL_WSS_URL` (Testnet), `RLUSD_ISSUER_ADDRESS` (⚠️ VERIFY_AT_BUILD), seeds for `HOT/EUD_ISSUER/COMPLIANCE_ISSUER/OPS`, `COLD_TREASURY_ADDRESS` (address only — never a seed), `DEVICE_MODE`, `BRIDGE_SERIAL_PORT`, `BRIDGE_HTTP_PORT`, `ANTHROPIC_API_KEY`, `CONTEXT7_API_KEY`, `RISK_SERVICE_URL`, `AGENT_INTERVAL_S`, `DEMO_MODE`. Policy thresholds live in `ops/config/policy.yaml` (versioned, hot-reloadable, version stamped into every GateDecision).

---

## 8. Build plan (phases × lanes)

Lanes: **A** XRPL core · **B** Hardware · **C** Pipeline/Risk/Agent · **D** Dashboard. **B starts immediately.**

| Phase | Focus | Gate |
|---|---|---|
| **P0 — Foundations** (pre-event + first hours) | All: monorepo scaffold from `Ripple_tests`, shared schemas, `.env`, **MCP + skill setup (0.1)**, SQLite. A: accounts funded, feature check. B: device flashes, `GET_INFO` returns pubkey over serial; **simulator built first**. | `pnpm dev` boots everything; bridge (simulator) answers; testnet accounts live. |
| **P1 — XRPL core** | A: trustlines, EUD mint, AMMs, routing, AUTO executor with hardcoded intent. | One RLUSD→EUD AUTO payment settles, visible on explorer. |
| **P2 — Pipeline + gate** | C: controller, policy gate (full test table), audit log, queue — services stubbed. D: pipeline feed + queue skeleton. | Stubbed intents reach all three outcomes deterministically. |
| **P3 — Real services** | C: risk (datagen → train → registry → /score + SHAP). A: compliance (sanctions + credentials provisioned). | Gate driven by real service outputs; SHAP renders. |
| **P4 — VETO + hardware** | B+A: sign-at-approval flow, digest contract, canonical-sig verification, device display, settle. D: review pane + device-state WS. | Full VETO chain on **hardware**: dashboard approve → physical button → `tesSUCCESS`. |
| **P5 — AI + agent + polish** | C: intake, explainer, agent. D: journal, audit explorer, simulator badge, styling. All: demo rehearsal ×3, failure drills (kill risk svc, unplug device, drop Wi-Fi). | Six-beat demo runs twice consecutively without intervention. |

**Cut order if behind:** S-goals → agent journal LLM polish → audit explorer view → AI Intake (keep manual form) → **never cut:** policy gate tests, VETO hardware path, simulator fallback.

---

## 9. Demo script — six beats (~5 min)

1. **Intake:** paste supplier email → AI structures → human confirms → pipeline.
2. **AUTO:** small payment to credentialed counterparty → live services → gate AUTO → hot key signs → ~4 s settle → explorer proof.
3. **VETO trigger:** large payment to new (uncredentialed) counterparty → held; SHAP + narrative show *why*.
4. **The hardware moment:** approve on dashboard → "Confirm on device" → Firefly shows destination/amount → **physical button** → settles on-ledger. ("The AI never touched this key — it can't. It only exists here." *Hold up the device.*)
5. **BLOCK:** sanctioned counterparty → hard stop, nothing moves, audit trail shown.
6. **Autonomy, governed:** hot float is low from beat 2 — the Treasury Agent *autonomously* files a refill intent… which lands in the VETO queue waiting for the human. Close: "Agents can act. They can never exceed the policy, and they can never sign."

---

## 10. Non-goals (binding)

- No XLS-65 Vaults / XLS-66 Lending / Permissioned DEX (XLS-80/81) — Devnet-gated and off-thesis (see Section 1 coverage table).
- No MPTokens (D4) — documented as evaluated.
- No on-device XRPL deserialization in MVP (D2 — mainnet-path item).
- No real sanctions data, real PII, or mainnet funds.
- No partial payments, ever (5.6).
- No multi-tenant/auth on the dashboard (single-operator demo).

---
