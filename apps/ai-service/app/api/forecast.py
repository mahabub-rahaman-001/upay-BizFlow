"""AI-01: Seven-day sales and cash-flow forecast (docs/08 section 4).

POST /v1/forecast/sales
{
  "business_id": "uuid",
  "history": [{"day": "YYYY-MM-DD", "sales_minor": 1500000}, ...],
  "cutoff": "YYYY-MM-DD",   // optional
  "category": "grocery",    // optional; used for LightGBM features
  "location_type": "urban"  // optional
}

Model served:
- LightGBM quantile (p10/p50/p90) if trained + passes quality gate
- Seasonal baseline otherwise (also production fallback when service is down)
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.ml.models import forecast_sales_lgbm

router = APIRouter()


class DailyHistory(BaseModel):
    day: str
    sales_minor: int


class ForecastRequest(BaseModel):
    business_id: str
    history: list[DailyHistory]
    cutoff: Optional[str] = None
    category: str = "other"
    location_type: str = "urban"


class DailyForecast(BaseModel):
    day: str
    p10_minor: int
    p50_minor: int
    p90_minor: int


class ForecastResponse(BaseModel):
    business_id: str
    model_version: str
    confidence: str
    abstained: bool
    reason: Optional[str]
    days: list[DailyForecast]


@router.post("/forecast/sales", response_model=ForecastResponse)
def forecast_sales(req: ForecastRequest) -> ForecastResponse:
    history = [h.model_dump() for h in req.history]
    cutoff = date.fromisoformat(req.cutoff) if req.cutoff else None

    result = forecast_sales_lgbm(
        history=history,
        cutoff=cutoff,
        business_id=req.business_id,
        category=req.category,
        location_type=req.location_type,
    )

    return ForecastResponse(
        business_id=result["business_id"],
        model_version=result["model_version"],
        confidence=result["confidence"],
        abstained=result["abstained"],
        reason=result.get("reason"),
        days=[DailyForecast(**d) for d in result["days"]],
    )
