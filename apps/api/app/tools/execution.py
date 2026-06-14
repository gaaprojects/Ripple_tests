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
from dataclasses import dataclass

from .. import xrpl_client
from ..config import get_settings
from ..schemas import ExecutionResult, PaymentIntent, PaymentStatus, RouteQuote


@dataclass
class EscrowResult:
    escrow_sequence: int
    tx_hash: str
    explorer_url: str | None


async def execute_payment(payment_id: str, intent: PaymentIntent, route: RouteQuote) -> ExecutionResult:
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
        "amount": _token_amount(settings.token_currency, route.dest_amount, settings),
    }
    # Paths + SendMax only apply to a cross-currency payment (the treasury spends
    # a different asset than it delivers). On a same-asset direct payment XRPL
    # rejects a redundant SendMax with temREDUNDANT, so only attach when routing
    # actually found a cross-currency path.
    if route.paths:
        kwargs["paths"] = route.paths
        if route.send_max is not None:
            kwargs["send_max"] = _token_amount(settings.token_currency, route.send_max, settings)
    if route.deliver_min is not None:
        kwargs["deliver_min"] = _token_amount(settings.token_currency, route.deliver_min, settings)
        kwargs["flags"] = PaymentFlag.TF_PARTIAL_PAYMENT

    async with xrpl_client.async_client() as client:
        response = await submit_and_wait(Payment(**kwargs), client, wallet)

    return _execution_result(response, settled_status=PaymentStatus.settled)


async def lock_payment(payment_id: str, intent: PaymentIntent, route: RouteQuote) -> EscrowResult:
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
    finish_after = datetime_to_ripple_time(datetime.now(timezone.utc) + timedelta(seconds=1))
    tx = EscrowCreate(
        account=wallet.address,
        destination=intent.to,
        amount=_token_amount(settings.token_currency, route.dest_amount, settings),
        finish_after=finish_after,
    )
    async with xrpl_client.async_client() as client:
        signed = await sign(await autofill(tx, client), wallet)
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
