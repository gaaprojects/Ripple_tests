"""In-memory payment store for the demo skeleton.

Swap for the SQLAlchemy models in app/models.py + a Postgres session when
persistence is needed (see docs/architecture.md). The route layer depends only
on these functions, so the swap is local.
"""

from __future__ import annotations

from .schemas import AgentLogEntry, CredentialLogEntry, CredentialRecord, Payment

_payments: dict[str, Payment] = {}
_logs: list[AgentLogEntry] = []
_credentials: dict[str, CredentialRecord] = {}
_credential_logs: list[CredentialLogEntry] = []


def save(payment: Payment) -> Payment:
    _payments[payment.id] = payment
    return payment


def get(payment_id: str) -> Payment | None:
    return _payments.get(payment_id)


def list_payments() -> list[Payment]:
    return sorted(_payments.values(), key=lambda p: p.created_at, reverse=True)


def append_log(entry: AgentLogEntry) -> None:
    _logs.append(entry)


def logs_for(payment_id: str) -> list[AgentLogEntry]:
    return [entry for entry in _logs if entry.payment_id == payment_id]


def save_credential(record: CredentialRecord) -> CredentialRecord:
    _credentials[record.id] = record
    return record


def get_credential(record_id: str) -> CredentialRecord | None:
    return _credentials.get(record_id)


def list_credentials() -> list[CredentialRecord]:
    return sorted(_credentials.values(), key=lambda r: r.created_at, reverse=True)


def append_credential_log(entry: CredentialLogEntry) -> None:
    _credential_logs.append(entry)


def credential_logs_for(record_id: str) -> list[CredentialLogEntry]:
    return [entry for entry in _credential_logs if entry.record_id == record_id]
