"""Autonomous treasury agent endpoints.

/treasury/goals      — manage the agent's payment goal list.
/treasury/run        — trigger an evaluation cycle immediately (for demo / cron).
/treasury/runs       — list recent run records.
/treasury/vault      — XLS-65 Single Asset Vault status + operations.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..agents import treasury_agent
from ..config import get_settings
from ..schemas import (
    TreasuryAgentRun,
    TreasuryGoal,
    TreasuryGoalCreate,
    VaultDepositRequest,
    VaultOpRecord,
    VaultStatus,
    VaultWithdrawRequest,
)
from ..tools import vault as vault_tool

router = APIRouter(prefix="/treasury")


@router.post("/goals", response_model=TreasuryGoal, status_code=201)
async def create_goal(request: TreasuryGoalCreate) -> TreasuryGoal:
    goal = treasury_agent.goal_from_create(request)
    return treasury_agent.add_goal(goal)


@router.get("/goals", response_model=list[TreasuryGoal])
async def list_goals() -> list[TreasuryGoal]:
    return treasury_agent.list_goals()


@router.get("/goals/{goal_id}", response_model=TreasuryGoal)
async def get_goal(goal_id: str) -> TreasuryGoal:
    goal = treasury_agent.get_goal(goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="goal not found")
    return goal


@router.delete("/goals/{goal_id}", status_code=204)
async def delete_goal(goal_id: str) -> None:
    if not treasury_agent.remove_goal(goal_id):
        raise HTTPException(status_code=404, detail="goal not found")


@router.post("/run", response_model=TreasuryAgentRun)
async def trigger_run() -> TreasuryAgentRun:
    """Trigger one evaluation cycle immediately.

    In production this would be called by a scheduler (cron / Railway cron job).
    The demo calls it explicitly so the cycle is visible in the UI.
    """
    if not get_settings().agent_enabled:
        raise HTTPException(status_code=403, detail="autonomous agent is disabled (AGENT_ENABLED=false)")
    return await treasury_agent.run()


@router.get("/runs", response_model=list[TreasuryAgentRun])
async def list_runs() -> list[TreasuryAgentRun]:
    return treasury_agent.list_runs()


# ── XLS-65 Vault endpoints ────────────────────────────────────────────────────

@router.get("/vault", response_model=VaultStatus)
async def get_vault_status() -> VaultStatus:
    """Return the current vault position and configuration."""
    settings = get_settings()
    state = vault_tool.get_vault_state()
    network = "mock" if settings.use_mock_xrpl else (
        "devnet" if "devnet" in settings.vault_xrpl_endpoint else "testnet"
    )
    recent_ops = [
        VaultOpRecord(
            id=op["id"],
            operation=op["operation"],
            amount=op["amount"],
            tx_hash=op["tx_hash"],
            explorer_url=op.get("explorer_url"),
            timestamp=datetime.fromisoformat(op["timestamp"]),
        )
        for op in state["operations"][-20:]  # last 20 ops
    ]
    return VaultStatus(
        vault_id=settings.vault_id or state["vault_id"],
        enabled=settings.vault_enabled,
        network=network,
        deposited=state["deposited"],
        shares=state["shares"],
        wallet_balance=state["wallet_balance"],
        asset_currency=settings.token_currency,
        asset_issuer=settings.token_issuer_address or None,
        sweep_threshold_usd=settings.vault_sweep_threshold_usd,
        recall_threshold_usd=settings.vault_recall_threshold_usd,
        recent_operations=list(reversed(recent_ops)),
    )


@router.post("/vault", response_model=VaultOpRecord, status_code=201)
async def create_vault() -> VaultOpRecord:
    """VaultCreate — provision a Single Asset Vault for the treasury token.

    In mock mode this is instantaneous. In real mode it submits a VaultCreate
    tx on the vault network (Devnet by default). The returned vault_id should
    be stored in VAULT_ID for subsequent deposit/withdraw calls.
    """
    settings = get_settings()
    result = await vault_tool.create_vault(
        asset_currency=settings.token_currency,
        asset_issuer=settings.token_issuer_address or "rMOCK_ISSUER",
    )
    return VaultOpRecord(
        id=str(result.vault_id[:8]),
        operation="create",
        amount=0.0,
        tx_hash=result.tx_hash,
        explorer_url=result.explorer_url,
        timestamp=datetime.now(timezone.utc),
    )


@router.post("/vault/deposit", response_model=VaultOpRecord, status_code=201)
async def deposit_to_vault(request: VaultDepositRequest) -> VaultOpRecord:
    """VaultDeposit — sweep the given amount into the vault to earn yield."""
    settings = get_settings()
    vault_id = settings.vault_id or vault_tool.get_vault_state().get("vault_id")
    if not vault_id:
        raise HTTPException(
            status_code=409,
            detail="No vault exists yet. Call POST /treasury/vault to create one first.",
        )
    result = await vault_tool.deposit(vault_id, request.amount)
    return VaultOpRecord(
        id=str(uuid.uuid4()),
        operation="deposit",
        amount=result.amount,
        tx_hash=result.tx_hash,
        explorer_url=result.explorer_url,
        timestamp=result.timestamp,
    )


@router.post("/vault/withdraw", response_model=VaultOpRecord, status_code=201)
async def withdraw_from_vault(request: VaultWithdrawRequest) -> VaultOpRecord:
    """VaultWithdraw — recall the given amount from the vault back to the treasury."""
    settings = get_settings()
    vault_id = settings.vault_id or vault_tool.get_vault_state().get("vault_id")
    if not vault_id:
        raise HTTPException(
            status_code=409,
            detail="No vault exists yet. Call POST /treasury/vault to create one first.",
        )
    result = await vault_tool.withdraw(vault_id, request.amount)
    return VaultOpRecord(
        id=str(uuid.uuid4()),
        operation="withdraw",
        amount=result.amount,
        tx_hash=result.tx_hash,
        explorer_url=result.explorer_url,
        timestamp=result.timestamp,
    )
