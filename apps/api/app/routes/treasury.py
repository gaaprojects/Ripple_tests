"""Autonomous treasury agent endpoints.

/treasury/goals — manage the agent's payment goal list.
/treasury/run   — trigger an evaluation cycle immediately (for demo / cron).
/treasury/runs  — list recent run records.
"""

from fastapi import APIRouter, HTTPException

from ..agents import treasury_agent
from ..config import get_settings
from ..schemas import TreasuryAgentRun, TreasuryGoal, TreasuryGoalCreate

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
