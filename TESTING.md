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
| `apps/api` → `src/audit.test.ts` | hash chain verifies when intact; **fails** on a tampered payload or a deleted row | §5.13, I4 |
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

## 7. P1 — XRPL core (in progress)

Once the provisioning CLIs land:

```bash
pnpm --filter @fx/api exec tsx ../../ops/provisioning/run-all.ts   # fund -> trustlines -> EUD -> AMMs -> SetRegularKey
# then the smoke payment:
pnpm --filter @fx/api exec tsx ../../ops/provisioning/smoke-payment.ts
```

**Acceptance (SPEC §5.8):** one hardcoded RLUSD→EUD AUTO payment routes through both seeded AMMs
and settles `tesSUCCESS` < 10 s; the tx is visible on `https://testnet.xrpl.org`; the float
ledger decrements; `verify-audit` reconstructs intent → route → submission → validation.

---

## Failure drills (rehearse before the demo — SPEC §8 P5)

- Kill the risk service mid-run → pipeline yields **degraded-VETO**, never a crash or AUTO.
- Unplug the Firefly → bridge surfaces the error; switch `DEVICE_MODE=simulator` to recover.
- Drop Wi-Fi → submission retries within `LastLedgerSequence`; expired windows rebuild.
