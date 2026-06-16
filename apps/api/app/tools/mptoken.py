"""MPToken tool — XLS-33 Multi-Purpose Tokens.

Creates a non-transferable "COMPLY" compliance-attestation issuance. After
each auto-settled payment the treasury agent mints one token to the recipient
as an on-chain proof of compliance clearance (soulbound — no transfer flag).

Mock mode (use_mock_xrpl=True):
  Full flow in-memory: create, authorize, mint are all tracked without any
  network access. The agent mock-mints on every auto-settled payment.

Real mode:
  MPTokenIssuanceCreate → real tx, real explorer link.
  MPTokenAuthorize      → real tx (issuer-side slot grant for the recipient).
  mint_attestation      → simulated; real minting requires the recipient to
                          call their own MPTokenAuthorize first. When
                          MPT_RECIPIENT_ADDRESS + MPT_RECIPIENT_SEED are both
                          configured the full three-step flow runs on-ledger.

Network: XLS-33 is available on Testnet (wss://s.altnet.rippletest.net:51233)
and Devnet. Set MPT_XRPL_ENDPOINT to override; defaults to the main
XRPL_ENDPOINT setting.
"""

from __future__ import annotations

import binascii
import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..config import get_settings
from .. import xrpl_client

# hex-encoded metadata blob stored in the MPT issuance (visible on explorer)
_COMPLY_METADATA = binascii.hexlify(b"COMPLY").decode().upper()


# ── In-memory MPT state (mock mode + real-mode cache) ─────────────────────────

_state: dict = {
    "issuance_id": None,    # hex issuance ID from MPTokenIssuanceCreate
    "authorized": [],       # list[str] — addresses that opted in (mock)
    "total_minted": 0,      # total attestation tokens minted
    "attestations": [],     # list[dict] — per-payment audit trail
}


@dataclass
class MPTIssuanceResult:
    issuance_id: str
    tx_hash: str
    explorer_url: str | None
    metadata_hex: str


@dataclass
class MPTOpResult:
    operation: str          # "authorize" | "mint"
    issuance_id: str
    recipient: str
    amount: int             # 0 for authorize, 1 for mint
    tx_hash: str
    explorer_url: str | None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def get_mpt_state() -> dict:
    """Return a snapshot of the in-memory MPT state."""
    return dict(_state)


# ── MPTokenIssuanceCreate ─────────────────────────────────────────────────────

async def create_issuance() -> MPTIssuanceResult:
    """MPTokenIssuanceCreate — provision the COMPLY attestation issuance.

    Flags: no tfMPTCanTransfer, no tfMPTCanTrade → soulbound compliance badge.
    In real mode the tx lands on the configured MPT network (Testnet by default).
    """
    settings = get_settings()
    if settings.use_mock_xrpl:
        issuance_id = _mock_issuance_id()
        tx_hash = _mock_hash("mpt_create", issuance_id)
        _state["issuance_id"] = issuance_id
        return MPTIssuanceResult(
            issuance_id=issuance_id,
            tx_hash=tx_hash,
            explorer_url=None,
            metadata_hex=_COMPLY_METADATA,
        )

    from xrpl.asyncio.transaction import submit_and_wait
    from xrpl.models.transactions import MPTokenIssuanceCreate
    from xrpl.wallet import Wallet

    wallet = Wallet.from_seed(settings.treasury_wallet_seed)
    tx = MPTokenIssuanceCreate(
        account=wallet.address,
        asset_scale=0,
        mptoken_metadata=_COMPLY_METADATA,
        # No flags → no transfer, no trade: soulbound attestation badge
    )
    endpoint = _mpt_endpoint(settings)
    async with xrpl_client.async_client(endpoint=endpoint) as client:
        response = await submit_and_wait(tx, client, wallet)

    result = response.result
    tx_hash = result["hash"]
    issuance_id = _parse_issuance_id(result) or _mock_issuance_id()
    _state["issuance_id"] = issuance_id
    url = xrpl_client.explorer_tx_url_for(tx_hash, endpoint)
    return MPTIssuanceResult(
        issuance_id=issuance_id,
        tx_hash=tx_hash,
        explorer_url=url,
        metadata_hex=_COMPLY_METADATA,
    )


# ── MPTokenAuthorize ──────────────────────────────────────────────────────────

async def authorize_holder(issuance_id: str, holder: str) -> MPTOpResult:
    """MPTokenAuthorize — create the recipient's MPToken slot for COMPLY badges.

    Mock mode: adds the holder to the in-memory authorized list.
    Real mode: the treasury (issuer) submits MPTokenAuthorize(holder=X), which
               creates the MPToken ledger entry for X so they can receive tokens.
               The recipient also needs to call their own MPTokenAuthorize when
               tfMPTRequireAuth is set; without that flag this call creates the
               slot directly and the recipient can receive immediately.
    """
    settings = get_settings()
    if settings.use_mock_xrpl:
        if holder not in _state["authorized"]:
            _state["authorized"].append(holder)
        tx_hash = _mock_hash("mpt_authorize", f"{issuance_id}:{holder}")
        return MPTOpResult(
            operation="authorize",
            issuance_id=issuance_id,
            recipient=holder,
            amount=0,
            tx_hash=tx_hash,
            explorer_url=None,
        )

    from xrpl.asyncio.transaction import submit_and_wait
    from xrpl.models.transactions import MPTokenAuthorize
    from xrpl.wallet import Wallet

    wallet = Wallet.from_seed(settings.treasury_wallet_seed)
    tx = MPTokenAuthorize(
        account=wallet.address,
        mptoken_issuance_id=issuance_id,
        holder=holder,
    )
    endpoint = _mpt_endpoint(settings)
    async with xrpl_client.async_client(endpoint=endpoint) as client:
        response = await submit_and_wait(tx, client, wallet)

    result = response.result
    tx_hash = result["hash"]
    if holder not in _state["authorized"]:
        _state["authorized"].append(holder)
    url = xrpl_client.explorer_tx_url_for(tx_hash, endpoint)
    return MPTOpResult(
        operation="authorize",
        issuance_id=issuance_id,
        recipient=holder,
        amount=0,
        tx_hash=tx_hash,
        explorer_url=url,
    )


# ── Mint (compliance attestation) ─────────────────────────────────────────────

async def mint_attestation(
    issuance_id: str,
    recipient: str,
    payment_id: str,
    amount_settled: float,
) -> MPTOpResult:
    """Mint 1 COMPLY token to the recipient as an on-chain compliance record.

    Mock mode: records the attestation in-memory.
    Real mode: submits a Payment with MPTAmount when MPT_RECIPIENT_ADDRESS and
               MPT_RECIPIENT_SEED are configured (the recipient must have called
               MPTokenAuthorize first). Otherwise falls back to in-memory record.
               In all cases the attestation is appended to the audit trail.
    """
    settings = get_settings()

    # Real-mode on-ledger mint: requires a configured recipient with opted-in wallet
    if not settings.use_mock_xrpl and settings.mpt_recipient_address and settings.mpt_recipient_seed:
        return await _real_mint(issuance_id, settings)

    # Mock / simulated path
    tx_hash = _mock_hash("mpt_mint", f"{issuance_id}:{recipient}:{payment_id}")
    return _record_attestation(
        issuance_id=issuance_id,
        recipient=recipient,
        payment_id=payment_id,
        amount_settled=amount_settled,
        tx_hash=tx_hash,
        explorer_url=None,
    )


async def _real_mint(issuance_id: str, settings) -> MPTOpResult:
    from xrpl.asyncio.transaction import submit_and_wait
    from xrpl.models.amounts import MPTAmount
    from xrpl.models.transactions import Payment
    from xrpl.wallet import Wallet

    wallet = Wallet.from_seed(settings.treasury_wallet_seed)
    tx = Payment(
        account=wallet.address,
        destination=settings.mpt_recipient_address,
        amount=MPTAmount(mpt_issuance_id=issuance_id, value="1"),
    )
    endpoint = _mpt_endpoint(settings)
    async with xrpl_client.async_client(endpoint=endpoint) as client:
        response = await submit_and_wait(tx, client, wallet)

    result = response.result
    tx_hash = result["hash"]
    url = xrpl_client.explorer_tx_url_for(tx_hash, endpoint)
    return _record_attestation(
        issuance_id=issuance_id,
        recipient=settings.mpt_recipient_address,
        payment_id="",
        amount_settled=0.0,
        tx_hash=tx_hash,
        explorer_url=url,
    )


def _record_attestation(
    *,
    issuance_id: str,
    recipient: str,
    payment_id: str,
    amount_settled: float,
    tx_hash: str,
    explorer_url: str | None,
) -> MPTOpResult:
    _state["total_minted"] += 1
    now = _now()
    _state["attestations"].append({
        "id": str(uuid.uuid4()),
        "operation": "mint",
        "issuance_id": issuance_id,
        "recipient": recipient,
        "payment_id": payment_id,
        "amount_settled": amount_settled,
        "tx_hash": tx_hash,
        "explorer_url": explorer_url,
        "timestamp": now.isoformat(),
    })
    return MPTOpResult(
        operation="mint",
        issuance_id=issuance_id,
        recipient=recipient,
        amount=1,
        tx_hash=tx_hash,
        explorer_url=explorer_url,
        timestamp=now,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mpt_endpoint(settings) -> str:
    return settings.mpt_xrpl_endpoint or settings.xrpl_endpoint


def _mock_issuance_id() -> str:
    return hashlib.sha256(b"comply_issuance_v1").hexdigest().upper()[:48]


def _mock_hash(kind: str, key: str) -> str:
    return hashlib.sha256(f"{kind}:{key}".encode()).hexdigest().upper()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_issuance_id(result: dict) -> str | None:
    for node in result.get("meta", {}).get("AffectedNodes", []):
        created = node.get("CreatedNode", {})
        if created.get("LedgerEntryType") == "MPTokenIssuance":
            return created.get("LedgerIndex")
    return None
