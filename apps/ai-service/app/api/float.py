"""AI-02: Agent float 24-hour demand forecast (docs/08 section 5).

POST /v1/forecast/float
{
  "business_id": "uuid",
  "hourly_history": [
    {"date": "YYYY-MM-DD", "hour": 9, "net_cash_demand_minor": 50000, "efloat_demand_minor": 80000},
    ...
  ],
  "cutoff_hour": 14   // optional: forecast from this hour onward
}
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.ml.models import forecast_float_baseline

router = APIRouter()


class HourlyHistory(BaseModel):
    date: str
    hour: int
    net_cash_demand_minor: int
    efloat_demand_minor: int = 0


class FloatRequest(BaseModel):
    business_id: str
    hourly_history: list[HourlyHistory]
    cutoff_hour: Optional[int] = None


class HourlyForecast(BaseModel):
    date: str
    hour: int
    p50_minor: int
    p90_minor: int


class FloatResponse(BaseModel):
    business_id: str
    model_version: str
    confidence: str
    abstained: bool
    hours: list[HourlyForecast]
    # Advice derived deterministically over forecast (docs/08 section 5)
    advice: Optional[str] = None
    advice_bn: Optional[str] = None


def _build_float_advice(hours: list[HourlyForecast], drawer_cash_minor: int = 0) -> tuple[str, str]:
    """Deterministic advice rule: needed_cash_by(h) = sum of p90 net demand.

    Returns (en_advice, bn_advice).
    """
    if not hours:
        return "", ""
    needed = sum(h.p90_minor for h in hours[:8])  # next 8 hours
    en = f"Keep at least Tk {needed // 100:,} cash to cover peak demand."
    bn = f"আগামী কয়েক ঘন্টার জন্য কমপক্ষে ৳{needed // 100:,} নগদ রাখুন।"
    return en, bn


@router.post("/forecast/float", response_model=FloatResponse)
def forecast_float(req: FloatRequest) -> FloatResponse:
    history = [h.model_dump() for h in req.hourly_history]
    result = forecast_float_baseline(
        hourly_history=history,
        business_id=req.business_id,
        cutoff_hour=req.cutoff_hour,
    )

    hours = [HourlyForecast(**h) for h in result["hours"]]
    en_advice, bn_advice = _build_float_advice(hours)

    return FloatResponse(
        business_id=result["business_id"],
        model_version=result["model_version"],
        confidence=result["confidence"],
        abstained=result["abstained"],
        hours=hours,
        advice=en_advice or None,
        advice_bn=bn_advice or None,
    )
