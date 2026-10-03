"""Model loader and predictor — serves both LightGBM and baseline fallback.

The model selection rule (docs/08 section 4.3):
- If models/sales7d_q50.lgb exists AND models.json says passed_gate=True → LightGBM
- Otherwise → seasonal baseline (always available, tested in CI)

This module is the single point where predictions are made; the API routers
import only from here, never from lightgbm directly.
"""
from __future__ import annotations

import json
import statistics
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

try:
    import numpy as np
    _NP_AVAILABLE = True
except ImportError:  # pragma: no cover
    _NP_AVAILABLE = False
    np = None  # type: ignore[assignment]

try:
    import lightgbm as lgb
    LGB_AVAILABLE = True
except ImportError:  # pragma: no cover
    LGB_AVAILABLE = False

from .baselines import (
    best_baseline_wape,
    seasonal_mean_4w,
    quantile_band,
    trend_seasonal,
)
from .calibration import apply_conformal, load_calibration
from .features import (
    AGENT_FEATURE_COLS,
    MERCHANT_FEATURE_COLS,
    build_merchant_features,
    build_agent_features,
    add_calendar_features,
)

ROOT = Path(__file__).parents[2]
MODEL_DIR = ROOT / "models"


def _load_manifest() -> dict:
    path = MODEL_DIR / "models.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}


def _load_lgb(name: str) -> Optional["lgb.Booster"]:
    path = MODEL_DIR / f"{name}.lgb"
    if LGB_AVAILABLE and path.exists():
        return lgb.Booster(model_file=str(path))
    return None


# ---------------------------------------------------------------------------
# Confidence helper (docs/08 section 4.4)
# ---------------------------------------------------------------------------

def _confidence(n_days: int) -> str:
    if n_days >= 56:
        return "high"
    if n_days >= 28:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# AI-01: Sales forecast (7-day)
# ---------------------------------------------------------------------------

def forecast_sales_baseline(
    history: list[dict],  # [{"day": "YYYY-MM-DD", "sales_minor": int}, ...]
    cutoff: Optional[date] = None,
    business_id: str = "",
) -> dict:
    """Seasonal-mean baseline forecast — always available, no ML dependency."""
    import pandas as pd

    hist_sorted = sorted(history, key=lambda h: h["day"])
    n = len(hist_sorted)
    values = [h["sales_minor"] for h in hist_sorted]

    if n < 14:
        return {
            "business_id": business_id,
            "model_version": "baseline-seasonal-0.1",
            "confidence": "low",
            "abstained": True,
            "reason": "Not enough history yet (need at least 14 days).",
            "days": [],
        }

    start = (cutoff or date.fromisoformat(hist_sorted[-1]["day"])) + timedelta(days=1)
    by_weekday: dict[int, list[int]] = {}
    for h in hist_sorted:
        d = date.fromisoformat(h["day"])
        by_weekday.setdefault(d.weekday(), []).append(h["sales_minor"])

    overall_med = int(statistics.median(values))
    forecast_days = []
    for i in range(7):
        d = start + timedelta(days=i)
        series = by_weekday.get(d.weekday()) or values
        recent = series[-4:]
        p50 = int(statistics.median(recent)) if recent else overall_med
        spread = int(statistics.pstdev(recent)) if len(recent) > 1 else int(0.20 * p50)
        p10 = max(0, p50 - spread)
        p90 = p50 + spread
        forecast_days.append({"day": d.isoformat(), "p10_minor": p10, "p50_minor": p50, "p90_minor": p90})

    return {
        "business_id": business_id,
        "model_version": "baseline-seasonal-0.1",
        "confidence": _confidence(n),
        "abstained": False,
        "reason": None,
        "days": forecast_days,
    }


def forecast_sales_lgbm(
    history: list[dict],
    cutoff: Optional[date] = None,
    business_id: str = "",
    category: str = "other",
    location_type: str = "urban",
) -> dict:
    """LightGBM quantile forecast; falls back to baseline if models not present."""
    import pandas as pd

    manifest = _load_manifest()
    sales_info = manifest.get("sales7d", {})
    use_lgbm = (
        LGB_AVAILABLE
        and sales_info.get("metrics", {}).get("passed_gate", False)
        and (_load_lgb("sales7d_q10") is not None)
    )

    if len(history) < 14:
        return {
            "business_id": business_id,
            "model_version": sales_info.get("active", "lgbm-quantile-0.1.0"),
            "confidence": "low",
            "abstained": True,
            "reason": "Not enough history yet (need at least 14 days).",
            "days": [],
        }

    if not use_lgbm:
        return forecast_sales_baseline(history, cutoff, business_id)

    # Build feature row for each forecast day
    # We reconstruct the training-like DataFrame from history.
    df_hist = pd.DataFrame(history)
    df_hist["category"] = category
    df_hist["location_type"] = location_type
    df_hist["business_id"] = business_id
    df_hist.rename(columns={"day": "date"}, inplace=True)
    if "digital_minor" not in df_hist.columns:
        df_hist["digital_minor"] = (df_hist["sales_minor"] * 0.40).astype(int)
    if "txn_count" not in df_hist.columns:
        df_hist["txn_count"] = (df_hist["sales_minor"] / 50_000).clip(lower=1).astype(int)
    if "refund_minor" not in df_hist.columns:
        df_hist["refund_minor"] = (df_hist["sales_minor"] * 0.01).astype(int)

    # Append 7 future placeholder rows (sales=0) for feature building
    start = (cutoff or date.fromisoformat(history[-1]["day"])) + timedelta(days=1)
    future_rows = [
        {
            "business_id": business_id,
            "category": category,
            "location_type": location_type,
            "date": (start + timedelta(days=i)).isoformat(),
            "sales_minor": 0,
            "digital_minor": 0,
            "txn_count": 0,
            "refund_minor": 0,
        }
        for i in range(7)
    ]
    df_all = pd.concat([df_hist, pd.DataFrame(future_rows)], ignore_index=True)
    df_feat = build_merchant_features(df_all)
    df_future = df_feat[df_feat["date"] > pd.Timestamp(cutoff or date.fromisoformat(history[-1]["day"]))]

    if len(df_future) < 7:
        return forecast_sales_baseline(history, cutoff, business_id)

    X = df_future[MERCHANT_FEATURE_COLS].astype(float)

    m10 = _load_lgb("sales7d_q10")
    m50 = _load_lgb("sales7d_q50")
    m90 = _load_lgb("sales7d_q90")

    p10 = np.maximum(0, m10.predict(X))
    p50 = np.maximum(0, m50.predict(X))
    p90 = np.maximum(0, m90.predict(X))

    # Apply conformal calibration if available
    cal = load_calibration("sales7d")
    if cal:
        p10, p90 = apply_conformal(p10, p90, cal)

    forecast_days = [
        {
            "day": (start + timedelta(days=i)).isoformat(),
            "p10_minor": int(p10[i]),
            "p50_minor": int(p50[i]),
            "p90_minor": int(p90[i]),
        }
        for i in range(7)
    ]

    return {
        "business_id": business_id,
        "model_version": sales_info.get("active", "lgbm-quantile-0.1.0"),
        "confidence": _confidence(len(history)),
        "abstained": False,
        "reason": None,
        "days": forecast_days,
    }


# ---------------------------------------------------------------------------
# AI-02: Agent float 24h forecast
# ---------------------------------------------------------------------------

def forecast_float_baseline(
    hourly_history: list[dict],
    business_id: str = "",
    cutoff_hour: Optional[int] = None,
) -> dict:
    """Baseline: median of same-hour same-weekday last 4 weeks."""
    from collections import defaultdict
    import datetime as _dt

    by_key: dict[tuple[int, int], list[int]] = defaultdict(list)
    for h in hourly_history:
        d = date.fromisoformat(h["date"])
        key = (d.weekday(), h["hour"])
        by_key[key].append(h["net_cash_demand_minor"])

    today = date.today()
    start_hour = (cutoff_hour or 0) + 1
    result_hours = []
    for h in range(start_hour, start_hour + 24):
        actual_hour = h % 24
        day_offset = h // 24
        target_date = today + timedelta(days=day_offset)
        key = (target_date.weekday(), actual_hour)
        samples = by_key.get(key, [0])[-4:]
        p50 = int(statistics.median(samples))
        p90 = int(p50 * 1.5)
        result_hours.append({
            "hour": actual_hour,
            "date": target_date.isoformat(),
            "p50_minor": max(0, p50),
            "p90_minor": max(0, p90),
        })

    return {
        "business_id": business_id,
        "model_version": "baseline-seasonal-0.1",
        "confidence": _confidence(len(set(h["date"] for h in hourly_history))),
        "abstained": len(hourly_history) < 7 * 24,
        "hours": result_hours,
    }
