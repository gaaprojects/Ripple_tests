"""Risk service (SPEC §5.5). P0 skeleton.

/health works now. /score returns a documented DETERMINISTIC PLACEHOLDER until P3 wires
the trained gradient-boosted model + SHAP TreeExplainer. The placeholder is flagged
`degraded: true` so the Policy Gate treats it conservatively (fail-closed, SPEC §5.3)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI

from .schemas import RiskResult, ScoreRequest, ShapContribution

app = FastAPI(title="fx-sentinel risk", version="0.1.0")

PLACEHOLDER_MODEL = "placeholder-0 (P3 replaces with trained GBT + SHAP)"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "risk", "model_version": PLACEHOLDER_MODEL, "trained": False}


@app.post("/score", response_model=RiskResult)
def score(req: ScoreRequest) -> RiskResult:
    # Transparent stand-in: higher ratio / new counterparty -> higher score. NOT a real model.
    raw = 0.2 + 0.5 * req.amount_to_float_ratio + (0.2 if req.new_counterparty else 0.0)
    s = max(0.0, min(1.0, raw))
    return RiskResult(
        score=s,
        model_version=PLACEHOLDER_MODEL,
        base_value=0.2,
        degraded=True,  # never let a placeholder masquerade as a trained model
        checked_at=_now(),
        shap=[
            ShapContribution(feature="amount_to_float_ratio", value=req.amount_to_float_ratio,
                             contribution=0.5 * req.amount_to_float_ratio),
            ShapContribution(feature="new_counterparty", value=float(req.new_counterparty),
                             contribution=0.2 if req.new_counterparty else 0.0),
        ],
    )
