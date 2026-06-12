# `ops/provisioning` — XRPL Testnet setup CLIs

One-time, **idempotent** command-line scripts that stand up the fx-sentinel demo on XRPL
**Testnet**: fund accounts, set trustlines, mint the demo EUR stable (`EUD`), create the two
AMMs that make RLUSD→EUD routable, point the cold treasury's `RegularKey` at the Firefly device,
and run the P1 smoke payment.

Every ledger mutation goes through `@fx/core`'s `submitAudited()`, which writes a hash-chained
audit record **before and after** submit (SPEC §0.3 rule 4 / I4). These scripts grow from the
team baseline `fund-wallet.js` / `send-payment.js` (SPEC §0.2).

> **Package:** `@fx/provisioning` (ESM, `type: module`). Depends on `@fx/core` (shared XRPL
> client, routing, AUTO executor, audit) and `@fx/shared` (zod contracts).

---

## Prerequisites

1. **Install + build** from the repo root:
   ```bash
   pnpm install
   pnpm --filter @fx/shared build && pnpm --filter @fx/core build
   ```
2. **`.env`** at the repo root (copy from `.env.example`). The scripts read seeds/addresses from
   it. `fund-accounts.ts` populates most of these for you on first run.
3. **Bridge running** *only* for `set-regular-key.ts` (it reads the device pubkey):
   ```bash
   pnpm dev:bridge      # DEVICE_MODE=simulator by default
   ```

All scripts run via `tsx` through the workspace filter — from **anywhere** in the repo:

```bash
pnpm --filter @fx/provisioning exec tsx <script>.ts
```

---

## The files

### Orchestration

| Script | What it does |
|---|---|
| **`run-all.ts`** | Runs the setup chain in order: `verify-rlusd → fund-accounts → trustlines → mint-eud → create-amms → set-regular-key`. Idempotent; re-run safely after fixing any step. Does **not** run `acquire-rlusd`/`smoke-payment` (those need HOT to hold RLUSD). |

### Setup steps (run order)

| # | Script | What it does |
|---|---|---|
| 1 | **`verify-rlusd.ts`** | Confirms the RLUSD Testnet issuer **on-ledger** (`account_info` + `gateway_balances`). Never trusts a hardcoded address from memory (SPEC §0.3 rule 1). |
| 2 | **`fund-accounts.ts`** | Funds the demo accounts from the Testnet faucet (HOT, EUD_ISSUER, COMPLIANCE_ISSUER, OPS, counterparties) and writes their seeds/addresses into `.env`. OPS is topped up extra for AMM owner reserves. The cold treasury **master seed** is written to `.provision-secrets.json` (gitignored) — never to `.env`. |
| 3 | **`trustlines.ts`** | Sets `DefaultRipple` on issuers and opens the EUD + RLUSD trustlines between treasury/hot/counterparties and the issuers. |
| 4 | **`mint-eud.ts`** | The EUD issuer mints `EUD` to OPS and the counterparties (the demo's destination asset). |
| 5 | **`create-amms.ts`** | OPS creates the **RLUSD/XRP** and **XRP/EUD** AMMs (`AMMCreate`) that make RLUSD→EUD routable via XRP auto-bridging. Sized so the demo trade moves price modestly. |
| 6 | **`set-regular-key.ts`** | Reads the device pubkey from the **bridge** `GET_INFO`, derives its classic address, and `SetRegularKey` on `COLD_TREASURY` to that address — so the cold key lives only on the device (I2). Signing *with* it is P4. |

### Acquire + smoke test

| Script | What it does |
|---|---|
| **`acquire-rlusd.ts`** | Gives HOT spendable RLUSD by converting XRP→RLUSD through the public RLUSD/XRP AMM (a self-payment). Usage: `acquire-rlusd.ts [seedVar=HOT_SEED] [amount=10]`. |
| **`smoke-payment.ts`** | **The P1 gate.** One hardcoded RLUSD→EUD AUTO payment from HOT to `COUNTERPARTY_OK`, routed RLUSD→XRP→EUD through both AMMs. Exact `Amount`, bounded `SendMax`, never partial. Settles `tesSUCCESS`, explorer-visible, and writes the intent→route→submit→validate audit trail. |

### Diagnostics & utilities

| Script | What it does |
|---|---|
| **`debug-state.ts`** | Prints HOT's trustline balances and both AMM pool sizes — the fastest way to see why a route is dry. |
| **`reset-audit.ts`** | Truncates the audit log to a clean genesis (Testnet dev data only) — handy before a fresh demo run. |
| **`lib.ts`** | Shared helpers: asset constants (`RLUSD_ISSUER`, `RLUSD_HEX`, `EUD_CURRENCY`), `walletFromEnv()`, `requireEnv()`, `iou()`, and `@fx/core` re-exports (`getClient`, `closeClient`, `submitAudited`, explorer URLs). |
| **`env-writer.ts`** | `readEnvFile()` / `upsertEnv()` — how `fund-accounts.ts` writes seeds back into `.env` without clobbering existing keys. |

---

## End-to-end: from empty `.env` to a settled payment

```bash
# 0. (once) install + build core packages
pnpm install && pnpm --filter @fx/shared build && pnpm --filter @fx/core build

# 1. start the device bridge (needed for SetRegularKey)
pnpm dev:bridge

# 2. run the whole setup chain (in a second terminal)
pnpm --filter @fx/provisioning exec tsx run-all.ts

# 3. give HOT some RLUSD to spend
pnpm --filter @fx/provisioning exec tsx acquire-rlusd.ts

# 4. the P1 smoke payment — RLUSD→EUD settles tesSUCCESS
pnpm --filter @fx/provisioning exec tsx smoke-payment.ts
```

Each step prints an explorer URL (`https://testnet.xrpl.org/transactions/<hash>`). Verify there.

---

## How to test it

**The P1 acceptance test** (SPEC §5.6 / §5.8) is the smoke payment plus an intact audit chain:

```bash
# 1. (optional) clean slate for the audit chain
pnpm --filter @fx/provisioning exec tsx reset-audit.ts

# 2. run the AUTO payment — expect "✓ AUTO settled: tesSUCCESS" + an explorer link
pnpm --filter @fx/provisioning exec tsx smoke-payment.ts

# 3. the audit chain reconstructs intent → route → submission → validation
pnpm --filter @fx/api exec tsx src/cli/verify-audit.ts
#    → "OK — audit chain intact (N records)"
```

If `smoke-payment` reports `no_route`, inspect liquidity and balances:

```bash
pnpm --filter @fx/provisioning exec tsx debug-state.ts
```

…and confirm **both** AMMs are funded and HOT holds RLUSD (re-run `acquire-rlusd.ts` if not).

**Routing note (SPEC §5.6).** The legacy `ripple_path_find` does **not** synthesize the 2-hop AMM
bridge RLUSD→XRP→EUD, so `@fx/core`'s `findRoute` falls back (`bridgeVia: { currency: "XRP" }`)
to a 2-leg quote — RLUSD→XRP and XRP→EUD, each a single hop the pathfinder can price — and
attaches an explicit `[[{currency:"XRP"}]]` path for the transactor.

**Unit tests** for the runtime these scripts call live in `packages/core`:

```bash
pnpm --filter @fx/core test     # audit hash chain: intact / tampered / deleted / undefined-key regressions
```

A verified reference run: deliver 1 EUD, quote ~0.75 RLUSD (5% slippage buffer for the small
Testnet pools), tx
[`55041C39…A7C687`](https://testnet.xrpl.org/transactions/55041C39723EED76DEC40EA42C08D2DB41AF42CE8DA23B2E5F2C1C3711A7C687).

---

## Safety

- **Secrets stay out of git.** `.env`, `.provision-secrets.json` (cold master seed), and
  `apps/bridge/.device-key.json` are all gitignored. `COLD_TREASURY` is stored as an **address
  only** — never its seed (SPEC §0.3 rule 3, I2).
- **Testnet only.** No mainnet funds, no real sanctions data or PII (SPEC §10).
- These CLIs are **idempotent** — safe to re-run; they skip work already present on-ledger.
