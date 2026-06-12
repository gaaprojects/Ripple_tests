"""Risk service (SPEC §5.5).

P2 interim: /score is a DETERMINISTIC, documented heuristic with SHAP-style additive
contributions (base + sum(contributions) == score, exactly). It is NOT flagged degraded —
it is the agreed pre-ML scorer, swappable for the trained GBT + TreeExplainer in P3 with
zero pipeline changes (same request/response contract). Killing this service demos the
fail-closed path: the Node client substitutes score 0.99 / degraded -> VETO.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import yaml
from fastapi import FastAPI

from .schemas import RiskResult, ScoreRequest, ShapContribution

app = FastAPI(title="fx-sentinel risk", version="0.2.0")

MODEL_VERSION = "heuristic-v1 (deterministic, pre-ML; P3 replaces with GBT + SHAP)"
BASE_VALUE = 0.05

# Corridor risk weights come from the versioned ops/config/corridors.yaml (SPEC §5.5).
_CORRIDORS_PATH = Path(__file__).resolve().parents[3] / "ops" / "config" / "corridors.yaml"


def _corridor_weight(corridor: str | None) -> float:
    try:
        cfg = yaml.safe_load(_CORRIDORS_PATH.read_text(encoding="utf-8"))
        if corridor and corridor in cfg.get("corridors", {}):
            return float(cfg["corridors"][corridor]["weight"])
        return float(cfg.get("default_weight", 0.6))
    except Exception:
        return 0.6  # unmapped/unreadable -> elevated, never crash the scorer


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "risk", "model_version": MODEL_VERSION, "trained": False}


@app.post("/score", response_model=RiskResult)
def score(req: ScoreRequest) -> RiskResult:
    """Deterministic additive heuristic. Each feature contributes a documented, bounded
    amount; contributions are SHAP-shaped so the dashboard renders them identically to the
    P3 model's real TreeExplainer output."""
    contribs: list[ShapContribution] = []

    def add(feature: str, value: float, contribution: float) -> None:
        contribs.append(ShapContribution(feature=feature, value=value, contribution=round(contribution, 6)))

    # Amount pressure: how much of the hot float this single payment consumes (0..0.40).
    ratio = max(0.0, min(1.0, req.amount_to_float_ratio))
    add("amount_to_float_ratio", ratio, 0.40 * ratio)

    # Counterparty novelty: first-ever payment to this destination (+0.18).
    add("new_counterparty", float(req.new_counterparty), 0.18 if req.new_counterparty else 0.0)

    # Corridor inherent risk from corridors.yaml (0..0.25 at weight 1.0).
    w = _corridor_weight(req.corridor)
    add("corridor_weight", w, 0.25 * w)

    # Velocity: bursts of intents in the last hour (0..0.12).
    v1 = min(req.velocity_1h, 6)
    add("velocity_1h", float(req.velocity_1h), 0.02 * v1)

    # Off-hours activity (UTC 22:00–05:59) is mildly suspicious (+0.05).
    off_hours = req.hour_of_day >= 22 or req.hour_of_day < 6
    add("hour_of_day", float(req.hour_of_day), 0.05 if off_hours else 0.0)

    raw = BASE_VALUE + sum(c.contribution for c in contribs)
    s = max(0.0, min(1.0, raw))
    if raw > 0 and s != raw:
        # Clipped: rescale contributions so base + sum still equals the reported score.
        scale = (s - BASE_VALUE) / (raw - BASE_VALUE) if raw != BASE_VALUE else 0.0
        contribs = [
            ShapContribution(feature=c.feature, value=c.value, contribution=round(c.contribution * scale, 6))
            for c in contribs
        ]

    return RiskResult(
        score=round(s, 6),
        model_version=MODEL_VERSION,
        base_value=BASE_VALUE,
        degraded=False,
        checked_at=_now(),
        shap=contribs,
    )
