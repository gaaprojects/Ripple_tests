"""Credentials tool: XRPL Credentials (XLS-70) KYC.

Issues and verifies on-ledger KYC credentials for counterparties. The treasury
(or a trusted KYC provider) issues a `CredentialCreate` to a subject; the subject
must `CredentialAccept` it before it is valid. Before auto-settling, the workflow
verifies the receiver holds an *accepted*, non-expired credential of the
configured type from the trusted issuer.

Determinism boundary: this tool only *reports* credential status. Whether a
missing credential escalates a payment to hardware approval is decided by
deterministic policy code, never by the LLM.

Best practices encoded here:
- The credential's `URI` points to off-chain verifiable-credential data — never
  put PII on-ledger.
- Issue with an `Expiration` so stale KYC lapses automatically.
- A credential is only trusted once the subject has accepted it (lsfAccepted).

In mock mode (settings.use_mock_xrpl) the lookups are deterministic and offline so
the full workflow runs without a ledger. Real submission/lookup is gated behind
the mock flag and a configured issuer.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from .. import xrpl_client
from ..config import get_settings
from ..schemas import CredentialStatus

# Demo subjects treated as un-KYC'd in mock mode, so the credential gate can be
# demonstrated offline. Everyone else is considered verified in the mock.
MOCK_UNVERIFIED_SUBJECTS = {"rUNVERIFIED00000000000000000000000"}


async def verify_kyc(subject: str) -> CredentialStatus:
    """Verify the subject holds a valid KYC credential from the trusted issuer."""
    settings = get_settings()
    if not settings.credential_kyc_enabled:
        return CredentialStatus(
            checked=False,
            verified=False,
            subject=subject,
            reason="KYC credential layer disabled",
        )

    issuer = settings.credential_issuer_address or settings.token_issuer_address
    credential_type = settings.credential_type

    if settings.use_mock_xrpl:
        return _mock_verify(subject, issuer, credential_type)

    try:
        obj = await xrpl_client.lookup_accepted_credential(
            subject, issuer, xrpl_client.credential_type_hex(credential_type)
        )
    except Exception as exc:  # network/ledger errors must not crash the workflow
        return CredentialStatus(
            checked=True,
            verified=False,
            subject=subject,
            issuer=issuer,
            credential_type=credential_type,
            reason=f"credential lookup failed: {exc}",
        )

    if obj is None:
        return CredentialStatus(
            checked=True,
            verified=False,
            subject=subject,
            issuer=issuer,
            credential_type=credential_type,
            reason="no accepted KYC credential from trusted issuer",
        )

    expiration = _from_ripple_time(obj.get("Expiration"))
    if expiration is not None and expiration < datetime.now(timezone.utc):
        return CredentialStatus(
            checked=True,
            verified=False,
            subject=subject,
            issuer=issuer,
            credential_type=credential_type,
            expiration=expiration,
            reason="KYC credential expired",
        )

    return CredentialStatus(
        checked=True,
        verified=True,
        subject=subject,
        issuer=issuer,
        credential_type=credential_type,
        expiration=expiration,
        uri=_hex_to_str(obj.get("URI")),
        reason="accepted KYC credential verified on-ledger",
    )


async def issue_credential(
    subject: str, uri: str | None = None, expiration: datetime | None = None
) -> dict:
    """Issue a KYC credential to `subject` (CredentialCreate).

    The subject must accept it before it verifies. Returns the submission result.
    """
    settings = get_settings()
    credential_type = settings.credential_type

    if settings.use_mock_xrpl:
        return {
            "txHash": _mock_hash("credential", subject),
            "subject": subject,
            "issuer": settings.credential_issuer_address,
            "credentialType": credential_type,
            "uri": uri,
            "explorerUrl": None,
            "accepted": False,
        }

    if not settings.credential_issuer_seed:
        raise NotImplementedError("CREDENTIAL_ISSUER_SEED required to issue credentials")

    from xrpl.asyncio.transaction import submit_and_wait
    from xrpl.models.transactions import CredentialCreate
    from xrpl.utils import str_to_hex
    from xrpl.wallet import Wallet

    wallet = Wallet.from_seed(settings.credential_issuer_seed)
    tx = CredentialCreate(
        account=wallet.address,
        subject=subject,
        credential_type=xrpl_client.credential_type_hex(credential_type),
        uri=str_to_hex(uri).upper() if uri else None,
        expiration=_to_ripple_time(expiration),
    )
    async with xrpl_client.async_client() as client:
        result = await submit_and_wait(tx, client, wallet)

    tx_hash = result.result["hash"]
    return {
        "txHash": tx_hash,
        "subject": subject,
        "issuer": wallet.address,
        "credentialType": credential_type,
        "uri": uri,
        "explorerUrl": xrpl_client.explorer_tx_url(tx_hash),
        "accepted": False,
    }


def _mock_verify(subject: str, issuer: str, credential_type: str) -> CredentialStatus:
    verified = subject not in MOCK_UNVERIFIED_SUBJECTS
    return CredentialStatus(
        checked=True,
        verified=verified,
        subject=subject,
        issuer=issuer,
        credential_type=credential_type,
        reason=(
            "mock: accepted KYC credential present"
            if verified
            else "mock: no KYC credential on file"
        ),
    )


# XRPL stores time as seconds since the Ripple epoch (2000-01-01T00:00:00 UTC).
RIPPLE_EPOCH_OFFSET = 946_684_800


def _to_ripple_time(value: datetime | None) -> int | None:
    if value is None:
        return None
    return int(value.timestamp()) - RIPPLE_EPOCH_OFFSET


def _from_ripple_time(value) -> datetime | None:
    if value is None:
        return None
    return datetime.fromtimestamp(int(value) + RIPPLE_EPOCH_OFFSET, tz=timezone.utc)


def _hex_to_str(value) -> str | None:
    if not value:
        return None
    try:
        return bytes.fromhex(value).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return str(value)


def _mock_hash(kind: str, key: str) -> str:
    return hashlib.sha256(f"{kind}:{key}".encode()).hexdigest().upper()
