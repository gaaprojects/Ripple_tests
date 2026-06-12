# Test path — fx-sentinel

How to verify each subsystem end-to-end. Acceptance criteria trace back to `SPEC.md` section
numbers. Run from the repo root unless noted.

## 0. Prerequisites

```bash
pnpm install
cp .env.example .env        # P0 health/bridge work without real seeds; P1 provisioning needs them
```

---

## 1. Automated unit tests

```bash
pnpm test                   # every workspace
```

| Suite | Proves | SPEC |
|---|---|---|
| `packages/core` → `src/audit.test.ts` | drives the real `appendAudit`/`verifyChain` against an in-memory DB: chain verifies when intact; **fails** on a tampered payload or deleted row; verifies payloads carrying `undefined`-valued keys/array elements (canonical JSON must match `JSON.stringify`) | §5.13, I4 |
| `apps/bridge` → `src/crypto.test.ts` | secp256k1 sign→verify round-trip; signature over a different digest is rejected; pubkey is stable for a given key | §5.2 |

Run one suite: `pnpm --filter @fx/api test` · `pnpm --filter @fx/bridge test`.

---

## 2. Audit hash chain (tamper-evidence) — SPEC §5.13

```bash
# After any run that wrote audit records:
pnpm --filter @fx/api exec tsx src/cli/verify-audit.ts
# → "OK — audit chain intact (N records)"
```

To prove tamper-evidence by hand: open `data/fx-sentinel.sqlite`, edit one `audit_log.payload`,
re-run the command → it exits non-zero with `TAMPER DETECTED — broken at <id>`.

---

## 3. API `/health` + amendment boot check — SPEC §5.1

```bash
pnpm dev:api
curl -s http://127.0.0.1:8080/health | jq
```

Expect: `ok:true`, the Testnet WSS URL, `policy_version`, `audit_chain.ok:true`, and
`amendments.credentials.enabled` — **true on Testnet** (verified 2026-06-11; resolves SPEC D1).

---

## 4. Device bridge — simulator — SPEC §5.2, D12

```bash
pnpm dev:bridge        # DEVICE_MODE=simulator (default)
```

```bash
# Stable pubkey (call twice, restart in between — same value):
curl -s http://127.0.0.1:8787/device/info

# Sign a 32-byte digest -> canonical low-S DER signature (SIGNED after ~2s "confirm" delay):
curl -s -X POST http://127.0.0.1:8787/device/sign \
  -H "Content-Type: application/json" \
  -d '{"request_id":"req-1","digest_hex":"AAAA...(64 hex chars)...","display":{"destination":"rDest","amount":"100","currency":"EUD","purpose":"test"},"timeout_ms":5000}'
```

WS device-state stream (for the dashboard): connect to `ws://127.0.0.1:8787/ws` and watch
`device_connected` / `awaiting_confirmation` / `approved` events.

**Acceptance (SPEC §5.2):** stable pubkey across reboots ✓; signature `xrpl.js` can verify
(low-S DER) ✓; flipping `DEVICE_MODE` requires zero code changes elsewhere ✓.

## 4b. Device bridge — hardware (Firefly on hand)

```bash
# .env: DEVICE_MODE=hardware, BRIDGE_SERIAL_PORT=COM3 (your port)
pnpm dev:bridge
curl -s http://127.0.0.1:8787/device/info     # GET_INFO over USB serial -> device pubkey
```

P0 gate is `GET_INFO` returning the device pubkey. Full `SIGN_REQUEST` + on-device display +
physical-button approval is exercised in **P4** (the VETO signing demo).

---

## 5. Dashboard skeleton — SPEC §5.14

```bash
pnpm dev:web        # http://localhost:3000
```

With the bridge running in simulator mode, the page shows the device info and the loud
**SIMULATED DEVICE** badge (D12). `pnpm dev` boots api + bridge + web together (P0 gate).

---

## 6. Risk service skeleton — SPEC §5.5

```bash
cd services/risk && pip install -r requirements.txt && cd ../..
pnpm dev:risk       # http://127.0.0.1:8000
curl -s http://127.0.0.1:8000/health
```

`/score` returns a **deterministic placeholder flagged `degraded:true`** until P3 trains the
gradient-boosted model + SHAP. The gate treats degraded risk conservatively (fail-closed).

---

## 7. P1 — XRPL core ✓ (verified on Testnet 2026-06-12)

Provisioning CLIs are idempotent and audited; run them in order (or via `run-all.ts`):

```bash
pnpm --filter @fx/provisioning exec tsx run-all.ts        # fund -> trustlines -> EUD -> AMMs -> SetRegularKey
pnpm --filter @fx/provisioning exec tsx acquire-rlusd.ts  # HOT buys RLUSD via the XRP/RLUSD AMM (XRP->RLUSD)
pnpm --filter @fx/provisioning exec tsx smoke-payment.ts  # the RLUSD->EUD AUTO payment
```

Inspect live pool/trustline state at any point:
`pnpm --filter @fx/provisioning exec tsx debug-state.ts`.

**Routing note (SPEC §5.6).** The legacy `ripple_path_find` does **not** synthesize the 2-hop
AMM bridge RLUSD→XRP→EUD, so `findRoute` falls back (`bridgeVia: { currency: "XRP" }`) to a
2-leg quote — RLUSD→XRP and XRP→EUD, each a single hop the pathfinder *can* price — and attaches
an explicit `[[{currency:"XRP"}]]` path. Exact `Amount`, bounded `SendMax`, never partial.

**Acceptance (SPEC §5.8) — met:** one hardcoded RLUSD→EUD AUTO payment routes through both
seeded AMMs and settles `tesSUCCESS` in seconds; `verify-audit` reconstructs intent → route →
submission → validation (4-record chain, intact). Verified tx:
[`55041C39…A7C687`](https://testnet.xrpl.org/transactions/55041C39723EED76DEC40EA42C08D2DB41AF42CE8DA23B2E5F2C1C3711A7C687)
(deliver 1 EUD, quote ~0.75 RLUSD, 5% slippage buffer for the small Testnet pools).

To reset the audit chain to a clean genesis for a fresh demo run:
`pnpm --filter @fx/provisioning exec tsx reset-audit.ts` (Testnet dev data only).

---

## Failure drills (rehearse before the demo — SPEC §8 P5)

- Kill the risk service mid-run → pipeline yields **degraded-VETO**, never a crash or AUTO.
- Unplug the Firefly → bridge surfaces the error; switch `DEVICE_MODE=simulator` to recover.
- Drop Wi-Fi → submission retries within `LastLedgerSequence`; expired windows rebuild.
