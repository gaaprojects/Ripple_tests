"""API-level integration tests for the payment workflow.

Exercises the FastAPI app end to end through the in-memory store and the mock
XRPL path (USE_MOCK_XRPL=true by default), covering the three terminal outcomes
the policy engine can produce — auto-settle, escalate-then-release, and block —
plus the receipt and signature-rejection edges.

All requests use TOKEN_CURRENCY=USD with USD intents so no FX/network call is
made, and no LLM/sanctions keys are set, so the whole flow is deterministic and
offline.
"""

from types import SimpleNamespace

import pytest
from eth_keys import keys
from fastapi.testclient import TestClient

from app import store
from app.main import app
from app.tools import credentials as credentials_tool
from app.tools import firefly

client = TestClient(app)

# An account on the local demo sanctions list (compliance.SANCTIONED_ACCOUNTS).
SANCTIONED_ACCOUNT = "rSANCTIONED000000000000000000000000"


@pytest.fixture(autouse=True)
def _clean_state():
    """Isolate each test from the shared in-memory store and mock credential state."""
    store._payments.clear()
    store._logs.clear()
    store._credentials.clear()
    store._credential_logs.clear()
    credentials_tool.reset_mock_state()
    yield


def _intent(amount: float, **overrides) -> dict:
    body = {
        "from": "rTREASURY00000000000000000000000000",
        "to": "rVENDOR0000000000000000000000000000",
        "senderName": "Acme AG",
        "senderCountry": "CH",
        "receiverName": "Vendor Alpha",
        "receiverCountry": "US",
        "receiverEntityType": "company",
        "purpose": "supplier_payment",
        "amount": amount,
        "currency": "USD",
        "reference": "INV-1042",
    }
    body.update(overrides)
    return body


def test_small_payment_auto_settles():
    response = client.post("/payments", json=_intent(500))
    assert response.status_code == 200
    payment = response.json()

    assert payment["status"] == "settled"
    assert len(payment["txHash"]) == 64
    # Mock mode hides fake explorer links so demos never show a dead URL.
    assert payment["explorerUrl"] is None
    assert payment["policyDecision"]["requiresApproval"] is False


def test_large_payment_escalates():
    response = client.post("/payments", json=_intent(50_000))
    assert response.status_code == 200
    payment = response.json()

    assert payment["status"] == "pending_approval"
    assert payment["policyDecision"]["requiresApproval"] is True
    assert payment["policyDecision"]["ruleFired"] == "amount_threshold"
    assert payment["escrowSequence"] is not None


def test_sanctioned_payment_is_blocked():
    response = client.post("/payments", json=_intent(500, to=SANCTIONED_ACCOUNT))
    assert response.status_code == 200
    payment = response.json()

    assert payment["status"] == "blocked"
    assert payment["policyDecision"]["blocked"] is True
    assert payment["compliance"]["sanctioned"] is True


def test_escalated_payment_releases_with_valid_signature(monkeypatch):
    # A signing keypair standing in for the Firefly device.
    private_key = keys.PrivateKey(b"\x11" * 32)
    public_key_hex = private_key.public_key.to_hex()
    monkeypatch.setattr(
        firefly, "get_settings", lambda: SimpleNamespace(firefly_public_key=public_key_hex)
    )

    created = client.post("/payments", json=_intent(50_000)).json()
    payment_id = created["id"]
    assert created["status"] == "pending_approval"

    challenge = client.get(f"/payments/{payment_id}/challenge").json()
    digest = bytes.fromhex(challenge["digest"])
    signature = private_key.sign_msg_hash(digest).to_hex()

    released = client.post(f"/payments/{payment_id}/release", json={"signature": signature})
    assert released.status_code == 200
    body = released.json()
    assert body["status"] == "released"
    assert body["approvalSignature"] == signature
    assert len(body["txHash"]) == 64


def test_release_with_bad_signature_is_rejected(monkeypatch):
    private_key = keys.PrivateKey(b"\x22" * 32)
    monkeypatch.setattr(
        firefly,
        "get_settings",
        lambda: SimpleNamespace(firefly_public_key=private_key.public_key.to_hex()),
    )

    payment_id = client.post("/payments", json=_intent(50_000)).json()["id"]

    # A signature from a different key must not verify.
    wrong_key = keys.PrivateKey(b"\x33" * 32)
    challenge = client.get(f"/payments/{payment_id}/challenge").json()
    forged = wrong_key.sign_msg_hash(bytes.fromhex(challenge["digest"])).to_hex()

    rejected = client.post(f"/payments/{payment_id}/release", json={"signature": forged})
    assert rejected.status_code == 403
    # The payment stays locked.
    assert client.get(f"/payments/{payment_id}").json()["status"] == "pending_approval"


def test_receipt_only_available_for_terminal_payments():
    settled_id = client.post("/payments", json=_intent(500)).json()["id"]
    pending_id = client.post("/payments", json=_intent(50_000)).json()["id"]

    ok = client.get(f"/payments/{settled_id}/receipt")
    assert ok.status_code == 200
    body = ok.json()
    assert len(body["receiptHash"]) == 64
    assert body["receipt"]["paymentId"] == settled_id

    not_ready = client.get(f"/payments/{pending_id}/receipt")
    assert not_ready.status_code == 409


def test_list_reflects_created_payments():
    client.post("/payments", json=_intent(500))
    client.post("/payments", json=_intent(50_000))

    listed = client.get("/payments").json()
    assert len(listed) == 2
    assert {p["status"] for p in listed} == {"settled", "pending_approval"}
