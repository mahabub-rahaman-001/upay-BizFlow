"""Feature engineering for AI-01 (merchant sales) and AI-02 (agent float).

All features derived from docs/08 section 4.2 (sales) and section 5 (float).
All monetary lags remain in integer poisha -- never cast to float until LightGBM.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

try:
    import numpy as np
    import pandas as pd
    _PANDAS_AVAILABLE = True
except ImportError:  # pragma: no cover
    _PANDAS_AVAILABLE = False
    np = None  # type: ignore[assignment]
    pd = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Calendar feature tables (config-driven; production pulls from settings table)
# ---------------------------------------------------------------------------

# Approximate BD public holidays (month, day) -- extend as needed.
BD_PUBLIC_HOLIDAYS: set[tuple[int, int]] = {
    (2, 21), (3, 17), (3, 25), (3, 26),
    (4, 14), (5, 1), (8, 15), (10, 16),
    (11, 7), (12, 16),
}

# Ramadan 2026 window (approximate; production uses calculated Islamic dates).
RAMADAN_2026 = (date(2026, 2, 28), date(2026, 3, 29))

# Eid-ul-Fitr 2026 (approx), Eid-ul-Adha 2026 (approx).
EID_DATES_2026 = [date(2026, 3, 30), date(2026, 6, 6)]

# SSC/HSC exam seasons (month ranges).
EXAM_SEASONS: list[tuple[int, int]] = [(2, 4), (9, 11)]  # (start_month, end_month)


def _is_ramadan(d: date) -> bool:
    return RAMADAN_2026[0] <= d <= RAMADAN_2026[1]


def _ramadan_day(d: date) -> int:
    if _is_ramadan(d):
        return (d - RAMADAN_2026[0]).days + 1
    return -1


def _is_eid_window(d: date) -> bool:
    for eid in EID_DATES_2026:
        if timedelta(-7) <= (d - eid) <= timedelta(3):
            return True
    return False


def _is_exam_season(d: date) -> bool:
    for (sm, em) in EXAM_SEASONS:
        if sm <= d.month <= em:
            return True
    return False


def add_calendar_features(df: pd.DataFrame, date_col: str = "date") -> pd.DataFrame:
    """Add all calendar features to a DataFrame that has a date column."""
    df = df.copy()
    dates = pd.to_datetime(df[date_col]).dt.date

    df["dow"] = [d.weekday() for d in dates]
    df["is_weekend_bd"] = [int(d.weekday() in (4, 5)) for d in dates]
    df["day_of_month"] = [d.day for d in dates]
    df["is_salary_week"] = [int(d.day <= 7) for d in dates]
    df["is_month_end"] = [int(d.day >= 25) for d in dates]
    df["month"] = [d.month for d in dates]
    df["week_of_year"] = pd.to_datetime(df[date_col]).dt.isocalendar().week.astype(int).values
    df["is_public_holiday"] = [int((d.month, d.day) in BD_PUBLIC_HOLIDAYS) for d in dates]
    df["is_ramadan"] = [int(_is_ramadan(d)) for d in dates]
    df["ramadan_day_index"] = [_ramadan_day(d) for d in dates]
    df["is_eid_window"] = [int(_is_eid_window(d)) for d in dates]
    df["is_pohela_boishakh"] = [int(d.month == 4 and d.day == 14) for d in dates]
    df["is_exam_season"] = [int(_is_exam_season(d)) for d in dates]
    return df


# ---------------------------------------------------------------------------
# AI-01: merchant daily sales features
# ---------------------------------------------------------------------------

MERCHANT_TARGET = "sales_minor"

MERCHANT_FEATURE_COLS = [
    "dow", "is_weekend_bd", "day_of_month", "is_salary_week", "is_month_end",
    "month", "week_of_year", "is_public_holiday", "is_ramadan", "ramadan_day_index",
    "is_eid_window", "is_pohela_boishakh", "is_exam_season",
    # lags
    "sales_d1", "sales_d7", "sales_d14", "sales_d28",
    "sales_same_dow_1w", "sales_same_dow_2w", "sales_same_dow_3w", "sales_same_dow_4w",
    # rolling
    "sales_mean_3d", "sales_mean_7d", "sales_mean_14d", "sales_mean_28d",
    "sales_median_7d", "sales_std_7d", "sales_std_28d", "sales_ewma_7d",
    # mix
    "digital_share_7d", "digital_share_28d", "avg_ticket_7d",
    "txn_count_7d", "refund_rate_28d",
    # business
    "category_enc", "location_enc", "business_age_days",
    # data quality
    "missing_days_28d", "days_since_last_closing", "manual_entry_share_7d",
]

CATEGORY_ENC = {"grocery": 0, "restaurant": 1, "pharmacy": 2, "clothing": 3, "other": 4}
LOCATION_ENC = {"urban": 0, "campus": 1, "rural": 2}


def build_merchant_features(df: pd.DataFrame) -> pd.DataFrame:
    """Build lag and rolling features for merchant sales data.

    Input df must be sorted by (business_id, date) with one row per business per day.
    Missing days are filled with 0 sales.
    """
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["business_id", "date"])

    df["category_enc"] = df["category"].map(CATEGORY_ENC).fillna(4).astype(int)
    df["location_enc"] = df["location_type"].map(LOCATION_ENC).fillna(0).astype(int)

    # Business age
    first_dates = df.groupby("business_id")["date"].transform("min")
    df["business_age_days"] = (df["date"] - first_dates).dt.days

    # Lags (grouped shift)
    for lag, col in [(1, "sales_d1"), (7, "sales_d7"), (14, "sales_d14"), (28, "sales_d28")]:
        df[col] = df.groupby("business_id")["sales_minor"].shift(lag).fillna(0).astype(int)

    # Same-weekday lags
    for w in range(1, 5):
        df[f"sales_same_dow_{w}w"] = (
            df.groupby("business_id")["sales_minor"].shift(7 * w).fillna(0).astype(int)
        )

    # Rolling
    g = df.groupby("business_id")["sales_minor"]
    df["sales_mean_3d"]   = g.transform(lambda s: s.shift(1).rolling(3,  min_periods=1).mean()).fillna(0).astype(int)
    df["sales_mean_7d"]   = g.transform(lambda s: s.shift(1).rolling(7,  min_periods=1).mean()).fillna(0).astype(int)
    df["sales_mean_14d"]  = g.transform(lambda s: s.shift(1).rolling(14, min_periods=1).mean()).fillna(0).astype(int)
    df["sales_mean_28d"]  = g.transform(lambda s: s.shift(1).rolling(28, min_periods=1).mean()).fillna(0).astype(int)
    df["sales_median_7d"] = g.transform(lambda s: s.shift(1).rolling(7,  min_periods=1).median()).fillna(0).astype(int)
    df["sales_std_7d"]    = g.transform(lambda s: s.shift(1).rolling(7,  min_periods=2).std()).fillna(0).astype(int)
    df["sales_std_28d"]   = g.transform(lambda s: s.shift(1).rolling(28, min_periods=2).std()).fillna(0).astype(int)
    df["sales_ewma_7d"]   = g.transform(lambda s: s.shift(1).ewm(span=7, min_periods=1).mean()).fillna(0).astype(int)

    # Mix features
    def _share(num_col: str, denom_col: str, window: int) -> pd.Series:
        num = df.groupby("business_id")[num_col].transform(
            lambda s: s.shift(1).rolling(window, min_periods=1).sum()
        )
        den = df.groupby("business_id")[denom_col].transform(
            lambda s: s.shift(1).rolling(window, min_periods=1).sum()
        )
        return (num / den.replace(0, np.nan)).fillna(0.4)

    df["digital_share_7d"]  = _share("digital_minor", "sales_minor", 7)
    df["digital_share_28d"] = _share("digital_minor", "sales_minor", 28)
    df["avg_ticket_7d"] = (
        df.groupby("business_id")["sales_minor"].transform(
            lambda s: s.shift(1).rolling(7, min_periods=1).mean()
        ) /
        df.groupby("business_id")["txn_count"].transform(
            lambda s: s.shift(1).rolling(7, min_periods=1).sum().replace(0, 1)
        )
    ).fillna(0).astype(int)
    df["txn_count_7d"] = df.groupby("business_id")["txn_count"].transform(
        lambda s: s.shift(1).rolling(7, min_periods=1).sum()
    ).fillna(0).astype(int)
    df["refund_rate_28d"] = _share("refund_minor", "sales_minor", 28)

    # Data quality placeholders (0 when not available from synthetic data)
    df["missing_days_28d"] = 0
    df["days_since_last_closing"] = 0
    df["manual_entry_share_7d"] = 0.0

    df = add_calendar_features(df, date_col="date")
    return df


# ---------------------------------------------------------------------------
# AI-02: agent float hourly features
# ---------------------------------------------------------------------------

AGENT_TARGET_CASH = "net_cash_demand_minor"
AGENT_TARGET_FLOAT = "efloat_demand_minor"

AGENT_FEATURE_COLS = [
    "hour", "dow", "is_weekend_bd", "day_of_month", "is_salary_week", "is_month_end",
    "month", "is_ramadan", "is_eid_window", "is_haat_day", "is_remittance_surge",
    # lags
    "demand_h1", "demand_same_hour_1w", "demand_same_hour_2w",
    "demand_same_hour_3w", "demand_same_hour_4w",
    # rolling
    "demand_mean_4h", "demand_mean_24h",
    "running_cash_demand_today", "running_efloat_change_today",
    # business
    "location_enc",
]


def build_agent_features(df: pd.DataFrame) -> pd.DataFrame:
    """Build lag and rolling features for agent hourly data."""
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df["datetime"] = df["date"] + pd.to_timedelta(df["hour"], unit="h")
    df = df.sort_values(["business_id", "datetime"])

    df["location_enc"] = df["location_type"].map(LOCATION_ENC).fillna(0).astype(int)
    if "month" not in df.columns:
        df["month"] = df["date"].dt.month
    if "is_month_end" not in df.columns:
        df["is_month_end"] = (df["date"].dt.day >= 25).astype(int)

    g = df.groupby("business_id")["net_cash_demand_minor"]
    df["demand_h1"] = g.shift(1).fillna(0).astype(int)

    for w in range(1, 5):
        df[f"demand_same_hour_{w}w"] = g.shift(24 * 7 * w).fillna(0).astype(int)

    df["demand_mean_4h"]  = g.transform(lambda s: s.shift(1).rolling(4,  min_periods=1).mean()).fillna(0).astype(int)
    df["demand_mean_24h"] = g.transform(lambda s: s.shift(1).rolling(24, min_periods=1).mean()).fillna(0).astype(int)

    # Running totals within each day
    df["day_key"] = df["business_id"].astype(str) + "_" + df["date"].dt.date.astype(str)
    df["running_cash_demand_today"] = df.groupby("day_key")["net_cash_demand_minor"].cumsum().shift(1).fillna(0).astype(int)
    df["running_efloat_change_today"] = df.groupby("day_key")["efloat_demand_minor"].cumsum().shift(1).fillna(0).astype(int)

    return df
