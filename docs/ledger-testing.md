# Ledger testing runbook — run on XRPL Testnet and verify on the explorers

This is the hands-on checklist for proving the agent end-to-end on a **real
XRPL ledger** and confirming every transaction on the two explorers:

- **testnet.xrpl.org** — <https://testnet.xrpl.org/>
- **XRPSCAN** — <https://xrpscan.com/>

It complements `docs/real-xrpl.md` (which explains the config knobs); this page
is the step list you follow during a test session.

---

## 0. Where to run this

> **Run on a machine with open network** (your laptop, or Railway).
> The Claude Code **web** sandbox blocks every XRPL host at its egress
> allowlist — the WebSocket endpoint (`s.altnet.rippletest.net:51233`), the
> faucet, **and** both explorers all return `403 Host not in allowlist`. You
> cannot fund wallets, submit transactions, or open explorer links from inside
> a web session.
>
> To test from a web session anyway, add these hosts to the environment's
> egress settings (see <https://code.claude.com/docs/en/claude-code-on-the-web>):
> `s.altnet.rippletest.net`, `faucet.altnet.rippletest.net`,
> `testnet.xrpl.org`, `xrpscan.com`, `api.xrpscan.com`.

Everything below assumes a local laptop run.

## 1. Prerequisites (one-time)

```bash
# Python API
cd apps/api
python -m venv .venv && . .venv/bin/activate     # Windows: . .venv/Scripts/activate
pip install -r requirements.txt
python -m pytest -q                              # sanity: 41 passing

# TypeScript workspaces (web + firefly bridge), from repo root
cd ..
npm install
npm run typecheck
```

Generate the Firefly mock signing keypair (the locked-payment release is gated
on a signature from this key):

```bash
npm run keygen --workspace @treasury/firefly-bridge
# prints FIREFLY_MOCK_PRIVATE_KEY=... and FIREFLY_PUBLIC_KEY=...
```

## 2. Configure `.env` (repo root)

Copy `.env.example` → `.env` and set the real-network values. The key flips:

```bash
USE_MOCK_XRPL=false
XRPL_ENDPOINT=wss://s.altnet.rippletest.net:51233
TOKEN_CURRENCY=XRP                 # start native — no trust lines
TREASURY_WALLET_SEED=              # filled in step 3
FIREFLY_PUBLIC_KEY=<from keygen>   # API verifies release signatures against this
FIREFLY_MOCK_PRIVATE_KEY=<from keygen>   # the bridge signs with this
POLICY_THRESHOLD_USD=10000         # lower it (e.g. 50) to force the escrow path on small amounts
```

`.env` is gitignored — seeds and keys never get committed.

## 3. Fund testnet wallets (faucet)

```bash
cd apps/api && . .venv/bin/activate
python scripts/smoke_xrpl.py fund     # run 2–3x: a TREASURY, a RECEIVER, (optional) an ISSUER
```

Each run prints `Address`, `Seed`, and an explorer link. Paste the **treasury**
seed into `TREASURY_WALLET_SEED`. Keep the receiver address handy as the payment
destination. Open the printed explorer link to confirm the account is funded.

## 4. Smoke test the connection (before the agent)

```bash
python scripts/smoke_xrpl.py status                 # endpoint + treasury balance
python scripts/smoke_xrpl.py pay <receiver-addr> 1  # send 1 XRP, prints tx hash + explorer URL
```

Open the printed `Explorer:` URL and confirm `tesSUCCESS`. Cross-check the same
hash on XRPSCAN (paste the hash into <https://xrpscan.com/>). If this works, the
agent will too — it uses the same client and seed.

## 5. Run the three processes

```bash
# Terminal 1 — API (reads root .env)
cd apps/api && . .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Firefly bridge (LOCAL ONLY, mock device by default)
npm run dev:bridge        # http://localhost:4747

# Terminal 3 — Web dashboard
npm run dev:web           # http://localhost:5173
```

Quick health check: `curl http://localhost:8000/health` → `{"status":"ok"}`.

## 6. Drive the two paths and verify on the explorers

You can use the dashboard (New Payment form) or curl. The API returns `txHash`
and `explorerUrl` on every real submission.

### 6a. Small / low-risk → **auto-settles** (direct Payment)

```bash
API=http://localhost:8000
curl -s -X POST $API/payments -H 'content-type: application/json' -d '{
  "from":"<treasury-addr>", "to":"<receiver-addr>",
  "senderName":"Acme GmbH", "senderCountry":"CH",
  "receiverName":"Vendor Alpha", "receiverCountry":"DE",
  "receiverEntityType":"business", "purpose":"invoice 1042",
  "amount":100, "currency":"USD", "reference":"INV-1042"
}' | python -m json.tool
```

Expect `status: "settled"` (or similar terminal state) with a `txHash` +
`explorerUrl`. **Verify:**
- Open `explorerUrl` (`https://testnet.xrpl.org/transactions/<hash>`) → `tesSUCCESS`, type `Payment`.
- Paste the hash into <https://xrpscan.com/> → same Payment, treasury → receiver.

### 6b. Large / flagged → **locks on-ledger** (EscrowCreate), released by Firefly

Use an amount above `POLICY_THRESHOLD_USD` (or lower the threshold in `.env`):

```bash
curl -s -X POST $API/payments -H 'content-type: application/json' -d '{
  "from":"<treasury-addr>", "to":"<receiver-addr>",
  "senderName":"Acme GmbH", "senderCountry":"CH",
  "receiverName":"Vendor Alpha", "receiverCountry":"DE",
  "receiverEntityType":"business", "purpose":"equipment",
  "amount":25000, "currency":"USD", "reference":"INV-2001"
}' | python -m json.tool
```

Expect a non-terminal status like `pending_approval` and an EscrowCreate
`txHash`. **Verify the lock:** open the hash on testnet.xrpl.org / XRPSCAN —
type `EscrowCreate`, funds locked on the treasury account.

Now release it with the hardware approval (mock device via the bridge). The
dashboard's **Approve** button does this; the manual equivalent:

```bash
PID=<paymentId from the response>
# 1. Get the challenge digest the device must sign
curl -s $API/payments/$PID/challenge | python -m json.tool
# 2. Bridge asks the (mock) Firefly to sign the digest
curl -s -X POST http://localhost:4747/sign -H 'content-type: application/json' \
  -d "{\"paymentId\":\"$PID\",\"digest\":\"<digest-from-challenge>\"}"
# 3. Submit the signature — API verifies it, then EscrowFinish
curl -s -X POST $API/payments/$PID/release -H 'content-type: application/json' \
  -d '{"signature":"<sig-from-bridge>"}' | python -m json.tool
```

Expect a terminal `settled` status and an **EscrowFinish** `txHash`. **Verify
the release:** open the hash on both explorers — type `EscrowFinish`, the
receiver is credited. The escrow is gone from the treasury's account objects.

> The release is gated by code: a wrong/tampered signature returns `403 Firefly
> signature rejected` and no EscrowFinish is submitted. With `DEMO_MODE=true`,
> `POST /payments/{id}/release-tampered` proves the signature is bound to the
> exact payment details.

## 7. (Optional) Issued token + Credentials

Once the XRP loop is proven, layer in:
- **USD IOU** (`TOKEN_CURRENCY=USD`): receiver needs a `TrustSet`; locking an
  issued token in escrow needs the **TokenEscrow (XLS-85)** amendment.
- **Credentials / KYC (XLS-70)**: see `docs/real-xrpl.md §6`. If an amendment is
  missing on Testnet, switch `XRPL_ENDPOINT` to Devnet
  (`wss://s.devnet.rippletest.net:51233`) and re-fund from the Devnet faucet.

## 8. What to capture as proof

For each of 6a and 6b, record the explorer URL on **both** sources:

| Step | Tx type | testnet.xrpl.org | XRPSCAN |
| --- | --- | --- | --- |
| 4 smoke pay | Payment | | |
| 6a auto-settle | Payment | | |
| 6b lock | EscrowCreate | | |
| 6b release | EscrowFinish | | |

All four should read `tesSUCCESS`. That is the live, explorer-backed proof the
demo gate calls for (`docs/PLAN.md`).

---

### Troubleshooting

- **`actNotFound` on status** — the treasury seed's account isn't funded; re-run `fund`.
- **`temREDUNDANT`** — a same-asset payment got a redundant `SendMax`; keep `TOKEN_CURRENCY=XRP` for the first loop (routing only attaches `SendMax`/`Paths` on real cross-currency paths).
- **Payment reported `failed` despite a hash** — the execution tool reads `meta.delivered_amount`; a partial/zero delivery is correctly reported as failed, not a false success.
- **`403 Firefly signature rejected`** — `FIREFLY_PUBLIC_KEY` in the API `.env` doesn't match the bridge's `FIREFLY_MOCK_PRIVATE_KEY`; re-run keygen and set both from the same pair.
- **Explorer can't find the hash** — give the ledger a few seconds to validate, then refresh; confirm you're on the **Testnet** explorer, not Mainnet.
