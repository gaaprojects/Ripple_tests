"""Thin XRPL helpers shared by the execution, routing and credentials tools.

Kept small on purpose: the tools own transaction building, this module owns
connection details, explorer URLs, pathfinding, and credential lookups.

`xrpl-py` is imported lazily inside each function so mock mode (and the test
suite) never need the dependency loaded — only the real-mode code paths pull it
in.
"""

from __future__ import annotations

from typing import Any

from .config import get_settings

TESTNET_EXPLORER = "https://testnet.xrpl.org"

# lsfAccepted on a Credential ledger entry: the subject has accepted the
# credential, so it is usable. An unaccepted credential must be ignored.
LSF_ACCEPTED = 0x00010000


def explorer_tx_url(tx_hash: str) -> str:
    return f"{TESTNET_EXPLORER}/transactions/{tx_hash}"


def explorer_account_url(address: str) -> str:
    return f"{TESTNET_EXPLORER}/accounts/{address}"


def async_client():
    """An XRPL async client for the configured endpoint."""
    from xrpl.asyncio.clients import AsyncWebsocketClient

    return AsyncWebsocketClient(get_settings().xrpl_endpoint)


def credential_type_hex(credential_type: str) -> str:
    """XRPL stores CredentialType as uppercase hex of the UTF-8 bytes."""
    from xrpl.utils import str_to_hex

    return str_to_hex(credential_type).upper()


async def find_payment_paths(
    source_account: str, destination_account: str, destination_amount: Any
) -> list[dict]:
    """Run ripple_path_find and return the ranked alternatives.

    Each alternative carries `paths_computed` (the Paths set) and `source_amount`
    (what the sender would spend). The caller picks the cheapest and caps SendMax.
    """
    from xrpl.models.requests import RipplePathFind

    request = RipplePathFind(
        source_account=source_account,
        destination_account=destination_account,
        destination_amount=destination_amount,
    )
    async with async_client() as client:
        response = await client.request(request)
    return response.result.get("alternatives", [])


async def lookup_accepted_credential(
    subject: str, issuer: str, credential_type_hex_value: str
) -> dict | None:
    """Return the subject's accepted credential matching issuer + type, or None.

    Only credentials with the lsfAccepted flag set are returned — an issued but
    unaccepted credential is not yet valid (the subject must CredentialAccept).
    """
    from xrpl.models.requests import AccountObjects

    async with async_client() as client:
        response = await client.request(
            AccountObjects(account=subject, type="credential")
        )
    for obj in response.result.get("account_objects", []):
        if obj.get("Issuer") != issuer:
            continue
        if obj.get("CredentialType") != credential_type_hex_value:
            continue
        if not int(obj.get("Flags", 0)) & LSF_ACCEPTED:
            continue
        return obj
    return None
