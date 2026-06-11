"""Pydantic mirror of @fx/shared Risk contracts (SPEC §6). Kept in sync with
packages/shared/src/services.ts."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ScoreRequest(BaseModel):
    intent_id: str
    amount_rlusd_eq: float
    corridor: str | None = None
    new_counterparty: bool = False
    velocity_1h: int = 0
    velocity_24h: int = 0
    hour_of_day: int = 0
    amount_to_float_ratio: float = 0.0


class ShapContribution(BaseModel):
    feature: str
    value: float
    contribution: float


class RiskResult(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    model_version: str
    shap: list[ShapContribution]
    base_value: float | None = None
    degraded: bool = False
    checked_at: str
