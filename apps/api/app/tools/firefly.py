"""Firefly approval tool.

Builds the approval challenge the Firefly hardware device signs, and verifies the
returned secp256k1 signature against the pre-registered public key. Release of a
locked payment is refused unless verification succeeds — this is the hardware
veto. The Firefly displays the request and signs only on a physical button press
(github.com/firefly).
"""

from __future__ import annotations

import hashlib

from eth_keys import keys
from eth_keys.exceptions import BadSignature, ValidationError

from ..config import get_settings
from ..schemas import ApprovalChallenge, Payment


def canonical_payload(payment_id: str, amount: float, currency: str, dest: str, reference: str) -> str:
    """Canonical string the device signs. Format is pinned: amount always 2dp.

    Every field shown to the operator on the device is bound into the signature —
    including the human-readable `reference` — so altering any of them after
    signing breaks verification (WYSIWYS).

    The TS bridge replicates this exactly:
        `${paymentId}|${amount.toFixed(2)}|${currency}|${dest}|${reference}`
    Any change here MUST be mirrored in apps/firefly-bridge/src/device.ts.
    """
    return f"{payment_id}|{amount:.2f}|{currency}|{dest}|{reference}"


def challenge_digest(payment_id: str, amount: float, currency: str, dest: str, reference: str) -> str:
    """sha256 of the canonical payload, hex-encoded."""
    return hashlib.sha256(
        canonical_payload(payment_id, amount, currency, dest, reference).encode()
    ).hexdigest()


def challenge_for_payment(payment: Payment) -> ApprovalChallenge:
    """Derive the approval challenge for a payment. The signed field set is named once here;
    pass a mutated copy to get the challenge for a tampered payment."""
    return _build_approval_challenge(
        payment.id,
        payment.intent.amount,
        payment.intent.currency,
        payment.intent.to,
        payment.intent.reference,
    )


def _build_approval_challenge(
    payment_id: str, amount: float, currency: str, dest: str, reference: str
) -> ApprovalChallenge:
    return ApprovalChallenge(
        payment_id=payment_id,
        digest=challenge_digest(payment_id, amount, currency, dest, reference),
    )


def verify_signature(digest_hex: str, signature_hex: str) -> bool:
    """Return True only if the signature over `digest_hex` was produced by the
    registered Firefly key. Returns False (never raises) on any bad input."""
    public_key_hex = get_settings().firefly_public_key
    if not public_key_hex:
        return False
    try:
        digest = bytes.fromhex(_strip0x(digest_hex))
        signature = keys.Signature(bytes.fromhex(_strip0x(signature_hex)))
        public_key = keys.PublicKey(bytes.fromhex(_strip0x(public_key_hex)))
        return signature.verify_msg_hash(digest, public_key)
    except (BadSignature, ValidationError, ValueError):
        return False


def _strip0x(value: str) -> str:
    return value[2:] if value.startswith("0x") else value
