# fx-sentinel

**Compliance-gated FX treasury agent on XRPL Testnet** — SwissHacks 2026 (Ripple "Future of
Finance on XRPL", *AI Agents for Finance*).

The thesis: **structurally separate AI intelligence from signing authority.** LLMs read and
explain; they never decide and never sign. A pure-function **Policy Gate** routes every payment
intent to one of three outcomes:

| Outcome | Meaning | Who signs |
|---|---|---|
| **AUTO** | small / low-risk | hot account server key (capped float) |
| **VETO** | held for review | the cold treasury key — **only** via a physical button press on a Firefly Pixie |
| **BLOCK** | hard stop | nothing moves |

Both authorized paths settle on XRPL in ~4 s. Full design: [`SPEC.md`](./SPEC.md). Operating
rules for contributors (and Claude Code): [`CLAUDE.md`](./CLAUDE.md).

> This repository grows from the team baseline
> [`tlukanie/Ripple_tests`](https://github.com/tlukanie/Ripple_tests) (SPEC §0.2). The two
> original scripts (`fund-wallet.js`, `send-payment.js`) become provisioning utilities under
> `ops/provisioning/`.

---

## Status

Implemented so far (**P0 Foundations** + **P1 XRPL core**):

- ✅ pnpm monorepo scaffold, shared zod contracts (`packages/shared`, SPEC §6); shared Node
  runtime in `packages/core` (config, audit, XRPL client, routing, AUTO executor)
- ✅ SQLite audit tier with tamper-evident **hash chain** (`packages/core`, SPEC §5.13 / I4)
- ✅ API `/health` with the **XLS-70 Credentials amendment boot check** — verified **enabled on
  Testnet** (resolves SPEC D1; no Devnet fallback needed)
- ✅ Device bridge (`apps/bridge`): HTTP/WS API, **simulator-first** signer + real-Firefly
  `GET_INFO` over USB serial; identical API both modes (D12). Signs a 32-byte digest →
  canonical **low-S DER secp256k1** signature
- ✅ Dashboard skeleton (`apps/web`) with the loud **SIMULATED DEVICE** badge
- ✅ Risk service skeleton (`services/risk`, FastAPI `/health`; trained model + SHAP is P3)
- ✅ **P1 XRPL core:** idempotent provisioning CLIs (`ops/provisioning`: fund accounts,
  trustlines, EUD mint, both AMMs, `SetRegularKey` to the device key) → routing
  (`ripple_path_find` + explicit XRP-bridge fallback) → **AUTO executor**. One hardcoded
  RLUSD→EUD payment settles `tesSUCCESS` on Testnet through both AMMs, exact `Amount` /
  bounded `SendMax` (never partial), with the audit chain reconstructing
  intent → route → submission → validation
  ([verified tx](https://testnet.xrpl.org/transactions/55041C39723EED76DEC40EA42C08D2DB41AF42CE8DA23B2E5F2C1C3711A7C687))
- ✅ **P2 Pipeline + Policy Gate:** pure-function gate (`packages/core/src/gate.ts`, zero
  runtime imports — I3) with table-driven tests covering every rule + boundary, golden-file
  replay test, deterministic Pipeline Controller (Compliance ∥ Risk ∥ Routing with per-service
  timeouts + fail-closed fallbacks), `POST /intents` API, float ledger (I5)
- ✅ **Compliance service:** synthetic sanctions screen + on-ledger **XLS-70 KYC credential**
  check (`ledger_entry` + `lsfAccepted`); `issue-credentials.ts` provisions
  CredentialCreate/Accept for `COUNTERPARTY_OK`
- ✅ **Risk service (interim):** deterministic heuristic `/score` with SHAP-shaped additive
  contributions (base + Σ = score); killing it demos the degraded→VETO fail-closed path.
  P3 swaps in the trained GBT + TreeExplainer behind the same contract
- ✅ **VETO path end-to-end (simulator):** approval builds a FRESH tx from `COLD_TREASURY`
  (fresh `Sequence`, `LastLedgerSequence`+40), digest → bridge → device signs (low-S DER) →
  local verify → submit. Verified settled on Testnet:
  [device-signed cold payment](https://testnet.xrpl.org/transactions/FEB66421885903869F24619DE9F22A4DA0FE1128F3F6518499716963FC8498D5)
- ✅ **Operations console** (`apps/web`): live pipeline feed (AUTO/VETO/BLOCK lanes), intent
  form with one-click demo presets, approval queue (SHAP bars, narrative, approve→device,
  live "CONFIRM ON DEVICE" state), treasury + float gauge, audit explorer with hash-chain
  status. All demo beats run from the dashboard alone
- ⏳ **Next:** P3 trained risk model · P4 real Firefly hardware signing · P5 AI intake/explainer
  + autonomous Treasury Agent

## Architecture

```
Intent sources (email/invoice, manual, Treasury Agent)
   → AI Intake (LLM draft, human-confirmed)
   → Pipeline Controller  ──▶  Compliance ∥ Risk(ML+SHAP) ∥ Routing
                          ──▶  Policy Gate (pure fn)
        AUTO ─ hot key                 VETO ─ approval queue ─▶ Bridge ─▶ Firefly Pixie
        BLOCK ─ hard stop                                       (cold key exists ONLY on device)
                          ──▶  XRPL TESTNET · ~4 s settlement
```

Invariants I1–I5 (no LLM in the signing/gate path; cold key only on device; pure replayable
gate; append-only audit; capped float) are asserted in code and tests. See `CLAUDE.md`.

### Workspace layout

| Path | What |
|---|---|
| `packages/shared` | zod schemas + TS types — the cross-service contracts (SPEC §6) |
| `packages/core` | shared Node runtime: config, audit hash chain, XRPL client, routing, AUTO executor |
| `apps/api` | Fastify: `/health` + amendment boot check; consumes `@fx/core` |
| `apps/bridge` | device daemon (USB serial ⇄ HTTP/WS) + simulator |
| `apps/web` | Next.js dashboard |
| `services/risk` | Python FastAPI risk service (ML + SHAP, P3) |
| `firmware/` | Pixie firmware extension (ESP-IDF, C) — Lane B |
| `ops/provisioning` | one-time setup CLIs (absorbs the baseline scripts) |
| `ops/config` | `policy.yaml`, `corridors.yaml` (versioned) |
| `data/sanctions` | synthetic demo sanctions list |

## Prerequisites

- Node ≥ 22, pnpm ≥ 11, Python ≥ 3.12, git
- Anthropic API key (AI features) and a Context7 key (SDK docs) — optional for P0
- A Firefly Pixie for the hardware demo (the simulator is a full fallback)

## Setup

```bash
pnpm install                 # installs all workspaces; builds native better-sqlite3
cp .env.example .env         # fill in seeds/addresses as you provision (see §7 of SPEC)
pnpm --filter @fx/shared build
```

The xrpl.org MCP and the XRPL dev skill are wired per SPEC §0.1 (the skill lives in
`.claude/skills/xrpl-dev/`). Firefly sources are vendored (gitignored) under `vendor/firefly/`.

## Run

```bash
pnpm dev          # boots api + bridge (simulator) + web together
pnpm dev:bridge   # bridge only
pnpm dev:api      # api only
pnpm dev:web      # dashboard only  → http://localhost:3000
pnpm dev:risk     # python risk service (needs: pip install -r services/risk/requirements.txt)
```

Default `DEVICE_MODE=simulator`. Set `DEVICE_MODE=hardware` and `BRIDGE_SERIAL_PORT=COMx` to
talk to a physical Firefly.

## Testing

See **[`TESTING.md`](./TESTING.md)** for the full manual + automated test path, and
**[`ops/provisioning/README.md`](./ops/provisioning/README.md)** for the XRPL setup CLIs and the
P1 smoke test. Quick version:

```bash
pnpm test                                    # all workspace unit tests
pnpm --filter @fx/core test                  # audit hash-chain (intact / tampered / deleted / undefined-key)
pnpm --filter @fx/bridge test                # secp256k1 sign/verify, stable pubkey
pnpm --filter @fx/api exec tsx src/cli/verify-audit.ts   # verify the live audit chain

# P1 end-to-end (XRPL Testnet) — see ops/provisioning/README.md:
pnpm --filter @fx/provisioning exec tsx run-all.ts        # fund → trustlines → EUD → AMMs → SetRegularKey
pnpm --filter @fx/provisioning exec tsx acquire-rlusd.ts  # HOT buys RLUSD via the XRP/RLUSD AMM
pnpm --filter @fx/provisioning exec tsx smoke-payment.ts  # RLUSD→EUD AUTO payment settles tesSUCCESS
```

## Security / non-goals

Seeds live only in `.env` (gitignored); the cold key never exists in software. No partial
payments, ever. No real sanctions data, PII, or mainnet funds. Full non-goals: `SPEC.md` §10.
