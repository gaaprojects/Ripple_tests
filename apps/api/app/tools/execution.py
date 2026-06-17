"""Execution tool.

Submits XRPL transactions: a direct token Payment for auto-settled payments, an
EscrowCreate to lock large/flagged payments (TokenEscrow / XLS-85 for issued
tokens), and an EscrowFinish to release them once a Firefly signature has been
verified.

In mock mode (settings.use_mock_xrpl) this returns deterministic fake tx hashes so
the full workflow runs offline. The real submission paths are gated behind the
mock flag and a configured treasury wallet. `xrpl-py` is imported lazily so mock
mode and the test suite never load it.

Pathfinding best practice: an auto-settled Payment carries the Paths set and
SendMax cap from the routing tool, optionally DeliverMin + tfPartialPayment, and
the delivered amount is read from `meta.delivered_amount` (never `Amount`) to
guard against the partial-payment exploit.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from .. import xrpl_client
from ..config import get_settings
from ..schemas import ExecutionResult, PaymentIntent, PaymentStatus, RouteQuote

# Memo type tag (hex of "compliance/v1") used to find the on-ledger compliance
# anchor among a transaction's Memos.
COMPLIANCE_MEMO_TYPE = "compliance/v1"


@dataclass
class EscrowResult:
    escrow_sequence: int
    tx_hash: str
    explorer_url: str | None


@dataclass
class ComplianceMemo:
    """Deterministic compliance data anchored on-ledger via transaction Memos.

    Built by the orchestrator from the policy/compliance result (never the LLM).
    `receipt_hash` is the pre-submission decision hash from the receipt tool.
    """

    aml_score: int
    rule_fired: str | None
    receipt_hash: str


def build_memo_fields(memo: ComplianceMemo) -> list[dict]:
    """Hex-encode a compliance memo into XRPL Memo fields (pure, no xrpl dep).

    Returns a single-element list of `{memo_type, memo_data}` dicts with
    uppercase-hex values, ready to splat into `xrpl.models.transactions.Memo`.
    Kept dependency-free so it can be unit-tested without loading xrpl-py.
    """
    payload = {
        "aml_score": memo.aml_score,
        "rule_fired": memo.rule_fired or "none",
        "receipt_hash": memo.receipt_hash,
    }
    data = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return [
        {
            "memo_type": COMPLIANCE_MEMO_TYPE.encode().hex().upper(),
            "memo_data": data.encode().hex().upper(),
        }
    ]


def _xrpl_memos(memo: ComplianceMemo | None):
    """Build xrpl Memo models from a ComplianceMemo, or None when absent."""
    if memo is None:
        return None
    from xrpl.models.transactions import Memo

    return [Memo(**fields) for fields in build_memo_fields(memo)]


async def execute_payment(
    payment_id: str,
    intent: PaymentIntent,
    route: RouteQuote,
    memo: ComplianceMemo | None = None,
) -> ExecutionResult:
    """Direct token Payment for an auto-settled payment."""
    settings = get_settings()
    if settings.use_mock_xrpl:
        tx_hash = _mock_hash("pay", payment_id)
        return ExecutionResult(
            tx_hash=tx_hash,
            explorer_url=None,
            status=PaymentStatus.settled,
        )

    from xrpl.asyncio.transaction import submit_and_wait
    from xrpl.models.transactions import Payment
    from xrpl.models.transactions.payment import PaymentFlag
    from xrpl.wallet import Wallet

    wallet = Wallet.from_seed(settings.treasury_wallet_seed)
    kwargs: dict = {
        "account": wallet.address,
        "destination": intent.to,
        "amount": _settle_amount(settings.token_currency, route.dest_amount, settings),
    }
    # Paths + SendMax only apply to a cross-currency payment (the treasury spends
    # a different asset than it delivers). On a same-asset direct payment XRPL
    # rejects a redundant SendMax with temREDUNDANT, so only attach when routing
    # actually found a cross-currency path.
    if route.paths:
        kwargs["paths"] = route.paths
        if route.send_max is not None:
            kwargs["send_max"] = _settle_amount(settings.token_currency, route.send_max, settings)
    if route.deliver_min is not None:
        kwargs["deliver_min"] = _settle_amount(settings.token_currency, route.deliver_min, settings)
        kwargs["flags"] = PaymentFlag.TF_PARTIAL_PAYMENT
    memos = _xrpl_memos(memo)
    if memos is not None:
        kwargs["memos"] = memos

    async with xrpl_client.async_client() as client:
        response = await submit_and_wait(Payment(**kwargs), client, wallet)

    return _execution_result(response, settled_status=PaymentStatus.settled)


async def lock_payment(
    payment_id: str,
    intent: PaymentIntent,
    route: RouteQuote,
    memo: ComplianceMemo | None = None,
) -> EscrowResult:
    """EscrowCreate to lock funds for a payment that needs hardware approval."""
    settings = get_settings()
    if settings.use_mock_xrpl:
        tx_hash = _mock_hash("escrow", payment_id)
        return EscrowResult(
            escrow_sequence=_mock_sequence(payment_id),
            tx_hash=tx_hash,
            explorer_url=None,
        )

    from xrpl.asyncio.transaction import autofill, sign, submit_and_wait
    from xrpl.models.transactions import EscrowCreate
    from xrpl.utils import datetime_to_ripple_time
    from xrpl.wallet import Wallet
    from datetime import datetime, timedelta, timezone

    wallet = Wallet.from_seed(settings.treasury_wallet_seed)
    # FinishAfter must be safely in the future when the tx is APPLIED (the next
    # ledger closes ~4s later); +1s lands in the past and XRPL returns
    # tecNO_PERMISSION. Give margin for ledger latency.
    finish_after = datetime_to_ripple_time(datetime.now(timezone.utc) + timedelta(seconds=9))
    escrow_kwargs: dict = {
        "account": wallet.address,
        "destination": intent.to,
        "amount": _settle_amount(settings.token_currency, route.dest_amount, settings),
        "finish_after": finish_after,
    }
    memos = _xrpl_memos(memo)
    if memos is not None:
        escrow_kwargs["memos"] = memos
    tx = EscrowCreate(**escrow_kwargs)
    async with xrpl_client.async_client() as client:
        # `sign` is synchronous in xrpl-py 4.x; only autofill/submit are async.
        signed = sign(await autofill(tx, client), wallet)
        response = await submit_and_wait(signed, client)

    result = response.result
    tx_hash = result["hash"]
    sequence = result.get("tx_json", {}).get("Sequence") or result.get("Sequence")
    return EscrowResult(
        escrow_sequence=int(sequence),
        tx_hash=tx_hash,
        explorer_url=xrpl_client.explorer_tx_url(tx_hash),
    )


async def finish_escrow(payment_id: str, escrow_sequence: int) -> ExecutionResult:
    """EscrowFinish to release a locked payment. Callers MUST verify the Firefly
    signature before invoking this — verification is not done here."""
    settings = get_settings()
    if settings.use_mock_xrpl:
        tx_hash = _mock_hash("finish", payment_id)
        return ExecutionResult(
            tx_hash=tx_hash,
            explorer_url=None,
            status=PaymentStatus.released,
        )

    from xrpl.asyncio.transaction import submit_and_wait
    from xrpl.models.transactions import EscrowFinish
    from xrpl.wallet import Wallet

    wallet = Wallet.from_seed(settings.treasury_wallet_seed)
    tx = EscrowFinish(
        account=wallet.address,
        owner=wallet.address,
        offer_sequence=escrow_sequence,
    )
    async with xrpl_client.async_client() as client:
        response = await submit_and_wait(tx, client, wallet)

    return _execution_result(response, settled_status=PaymentStatus.released)


def _execution_result(response, settled_status: PaymentStatus) -> ExecutionResult:
    """Map an XRPL submit_and_wait response to an ExecutionResult.

    Reads the engine result and `meta.delivered_amount` (the partial-payment
    guard): a tesSUCCESS that delivered nothing is treated as failed.
    """
    result = response.result
    tx_hash = result["hash"]
    meta = result.get("meta") or {}
    engine_result = meta.get("TransactionResult")
    delivered = meta.get("delivered_amount")
    status = settled_status
    if engine_result != "tesSUCCESS" or delivered in (None, "0", 0):
        status = PaymentStatus.failed
    return ExecutionResult(
        tx_hash=tx_hash,
        explorer_url=xrpl_client.explorer_tx_url(tx_hash),
        status=status,
    )


def scaled_settlement(value: float, settings) -> float:
    """Scale a settlement amount for the on-ledger transaction only.

    See `Settings.testnet_settlement_scale`: on a valueless testnet a real $10k+
    payment can't be funded in XRP, so the amount locked/paid on-ledger is scaled
    to a fundable size while policy/compliance/audit keep the true amount. A 1.0
    scale (production default) is a no-op. Floored at 1 drop so a small scaled
    amount never collapses to an invalid 0-value XRPL amount.
    """
    scale = settings.testnet_settlement_scale
    if scale == 1.0:
        return value
    return max(round(value * scale, 6), 0.000001)


def _settle_amount(currency: str, value: float, settings):
    """`_token_amount` with the testnet settlement scale applied to the value."""
    return _token_amount(currency, scaled_settlement(value, settings), settings)


def _token_amount(currency: str, value: float, settings):
    """Build an XRPL amount: drops for XRP, IssuedCurrencyAmount for a token."""
    if currency.upper() == "XRP":
        from xrpl.utils import xrp_to_drops

        return xrp_to_drops(value)
    from xrpl.models.amounts import IssuedCurrencyAmount

    return IssuedCurrencyAmount(
        currency=currency, issuer=settings.token_issuer_address, value=str(value)
    )


def _mock_hash(kind: str, payment_id: str) -> str:
    return hashlib.sha256(f"{kind}:{payment_id}".encode()).hexdigest().upper()


def _mock_sequence(payment_id: str) -> int:
    return int(hashlib.sha256(payment_id.encode()).hexdigest()[:6], 16)
