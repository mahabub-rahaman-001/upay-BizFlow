"""Synthetic data generator for BizFlow AI training (P6).

Generates 180 days of realistic daily merchant sales and hourly agent
float data for 12 merchants and 6 agents. All amounts in integer poisha.

Usage:
    python -m data.generator           # writes parquet to data/
    python -m data.generator --seed 7  # different seed
"""
from __future__ import annotations

import argparse
import math
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).parent
SEED = 42

# ---------------------------------------------------------------------------
# Business definitions
# ---------------------------------------------------------------------------

MERCHANT_CONFIGS = [
    {"id": "m01", "name": "Karim Store",        "category": "grocery",    "location_type": "urban",  "base_daily_minor": 1_500_000},
    {"id": "m02", "name": "Rahim Grocers",       "category": "grocery",    "location_type": "campus", "base_daily_minor": 1_200_000},
    {"id": "m03", "name": "Dhaka Fresh",         "category": "grocery",    "location_type": "urban",  "base_daily_minor": 2_000_000},
    {"id": "m04", "name": "Campus Bites",        "category": "restaurant", "location_type": "campus", "base_daily_minor": 800_000},
    {"id": "m05", "name": "Noodles Corner",      "category": "restaurant", "location_type": "urban",  "base_daily_minor": 1_100_000},
    {"id": "m06", "name": "Hasan Pharmacy",      "category": "pharmacy",   "location_type": "urban",  "base_daily_minor": 900_000},
    {"id": "m07", "name": "MedPlus",             "category": "pharmacy",   "location_type": "rural",  "base_daily_minor": 600_000},
    {"id": "m08", "name": "Fashion Hub",         "category": "clothing",   "location_type": "urban",  "base_daily_minor": 1_800_000},
    {"id": "m09", "name": "Style Corner",        "category": "clothing",   "location_type": "campus", "base_daily_minor": 950_000},
    {"id": "m10", "name": "Quick Mart",          "category": "other",      "location_type": "urban",  "base_daily_minor": 700_000},
    {"id": "m11", "name": "Village Shop",        "category": "other",      "location_type": "rural",  "base_daily_minor": 400_000},
    {"id": "m12", "name": "Sunrise Traders",     "category": "other",      "location_type": "urban",  "base_daily_minor": 1_300_000},
]

AGENT_CONFIGS = [
    {"id": "a01", "name": "Rahim Agent Point",  "location_type": "urban",  "base_hourly_minor": 200_000},
    {"id": "a02", "name": "Campus Agent",        "location_type": "campus", "base_hourly_minor": 150_000},
    {"id": "a03", "name": "Rural Agent Karim",   "location_type": "rural",  "base_hourly_minor": 80_000,  "is_haat": True},
    {"id": "a04", "name": "Motijheel Point",     "location_type": "urban",  "base_hourly_minor": 300_000},
    {"id": "a05", "name": "Uttara Agent",        "location_type": "urban",  "base_hourly_minor": 250_000},
    {"id": "a06", "name": "Rural Haat Point",    "location_type": "rural",  "base_hourly_minor": 100_000, "is_haat": True},
]

# Approximate Eid and Ramadan windows for the synthetic period (config-driven in production).
# Dates relative to a 180-day window ending today.
EID_FITR_OFFSET = 90    # day-of-window index (approx mid-period)
EID_ADHA_OFFSET = 140
RAMADAN_START_OFFSET = 60
RAMADAN_LENGTH = 29

CATEGORY_WEEKEND_FACTOR = {
    "grocery": {"fri": 0.75, "sat": 1.10},
    "restaurant": {"fri": 0.60, "sat": 1.20},
    "pharmacy": {"fri": 0.85, "sat": 1.00},
    "clothing": {"fri": 0.50, "sat": 1.30},
    "other": {"fri": 0.80, "sat": 1.05},
}


# ---------------------------------------------------------------------------
# Calendar helpers
# ---------------------------------------------------------------------------

def _calendar_multiplier(d: date, category: str, day_of_window: int, is_haat: bool = False) -> float:
    """Return a sales multiplier for a given day based on calendar effects."""
    mult = 1.0
    dow = d.weekday()  # 0=Mon ... 6=Sun
    dom = d.day
    factors = CATEGORY_WEEKEND_FACTOR.get(category, {"fri": 0.80, "sat": 1.05})

    # Bangladeshi weekend
    if dow == 4:  # Friday
        mult *= factors["fri"]
    elif dow == 5:  # Saturday
        mult *= factors["sat"]

    # Salary week (1-3 of month): extra spending power
    if dom in (1, 2, 3):
        mult *= 1.55
    elif dom in (4, 5, 6, 7):
        mult *= 1.25

    # Month-end slowdown
    if dom >= 27:
        mult *= 0.90

    # Eid pre-period (+150%) and Eid day (-60%) and post (+30%)
    for eid_offset in (EID_FITR_OFFSET, EID_ADHA_OFFSET):
        rel = day_of_window - eid_offset
        if -7 <= rel <= -1:
            mult *= 1.0 + 1.5 * (1 - abs(rel) / 7)
        elif rel == 0:
            mult *= 0.40  # Eid day: shops closed
        elif 1 <= rel <= 3:
            mult *= 1.30

    # Ramadan: late-night pattern; slight daily drop in normal hours
    if RAMADAN_START_OFFSET <= day_of_window < RAMADAN_START_OFFSET + RAMADAN_LENGTH:
        mult *= 0.88

    # Pohela Boishakh (14 Apr) -- boost
    if d.month == 4 and d.day == 14:
        mult *= 1.80

    # Haat day (rural agents): 2x on Thursday/Monday
    if is_haat and dow in (0, 3):
        mult *= 2.0

    return max(0.05, mult)


def _hourly_agent_profile(hour: int, location_type: str, is_salary_week: bool) -> float:
    """Return a relative weight for agent demand at this hour."""
    # Typical cash-out peaks: 9-11 and 15-17
    base = [
        0.1, 0.05, 0.02, 0.02, 0.02, 0.05,  # 0-5
        0.20, 0.60, 0.90, 1.00, 0.95, 0.80,  # 6-11
        0.60, 0.50, 0.70, 0.90, 0.85, 0.70,  # 12-17
        0.50, 0.35, 0.25, 0.18, 0.12, 0.10,  # 18-23
    ]
    w = base[hour]
    if is_salary_week:
        w *= 1.40
    if location_type == "campus" and hour in (12, 13):
        w *= 1.30  # lunch rush
    return w


# ---------------------------------------------------------------------------
# Merchant daily generator
# ---------------------------------------------------------------------------

def generate_merchant_data(rng: np.random.Generator, end_date: date, n_days: int = 180) -> pd.DataFrame:
    """Generate daily merchant sales rows."""
    rows: list[dict] = []
    start = end_date - timedelta(days=n_days - 1)

    for cfg in MERCHANT_CONFIGS:
        base = cfg["base_daily_minor"]
        trend = 1.0  # slight upward trend added below

        for i in range(n_days):
            d = start + timedelta(days=i)
            trend = 1.0 + 0.0003 * i  # ~5% growth over 180 days

            mult = _calendar_multiplier(d, cfg["category"], i)
            noise = float(rng.lognormal(0, 0.12))  # ~12% CV noise

            sales = int(base * trend * mult * noise)
            # Digital share: 30-60% depending on category
            digital_share = {"grocery": 0.35, "restaurant": 0.55, "pharmacy": 0.45,
                              "clothing": 0.50, "other": 0.40}.get(cfg["category"], 0.40)
            digital_noise = float(rng.normal(0, 0.05))
            dshare = max(0.0, min(1.0, digital_share + digital_noise))

            rows.append({
                "business_id": cfg["id"],
                "category": cfg["category"],
                "location_type": cfg["location_type"],
                "date": d.isoformat(),
                "dow": d.weekday(),
                "is_weekend_bd": int(d.weekday() in (4, 5)),
                "day_of_month": d.day,
                "is_salary_week": int(d.day <= 7),
                "is_month_end": int(d.day >= 25),
                "month": d.month,
                "is_ramadan": int(RAMADAN_START_OFFSET <= i < RAMADAN_START_OFFSET + RAMADAN_LENGTH),
                "is_eid_window": int(
                    abs(i - EID_FITR_OFFSET) <= 7 or abs(i - EID_ADHA_OFFSET) <= 7
                ),
                "sales_minor": max(0, sales),
                "digital_minor": int(max(0, sales) * dshare),
                "cash_minor": int(max(0, sales) * (1 - dshare)),
                "txn_count": max(1, int(rng.poisson(sales / 50_000))),
                "refund_minor": int(max(0, sales) * max(0.0, float(rng.normal(0.01, 0.005)))),
            })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Agent hourly generator
# ---------------------------------------------------------------------------

def generate_agent_data(rng: np.random.Generator, end_date: date, n_days: int = 180) -> pd.DataFrame:
    """Generate hourly agent transaction rows."""
    rows: list[dict] = []
    start = end_date - timedelta(days=n_days - 1)

    for cfg in AGENT_CONFIGS:
        base = cfg["base_hourly_minor"]
        is_haat = cfg.get("is_haat", False)

        for i in range(n_days):
            d = start + timedelta(days=i)
            day_mult = _calendar_multiplier(d, "other", i, is_haat=is_haat)
            is_salary_week = d.day <= 7

            for hour in range(24):
                hour_weight = _hourly_agent_profile(hour, cfg["location_type"], is_salary_week)
                if hour_weight < 0.03:
                    # Near-zero activity: skip (agent is closed)
                    continue

                noise = float(rng.lognormal(0, 0.20))
                demand = int(base * day_mult * hour_weight * noise)

                # Split into cash_in and cash_out (net = cash_out - cash_in)
                cash_out_share = float(rng.beta(3, 1))  # skewed toward cash-out
                cash_out = int(demand * cash_out_share)
                cash_in = demand - cash_out

                send_money = int(cash_out * float(rng.beta(1, 4)))  # small fraction
                commission = int((cash_out + cash_in + send_money) * 0.0025)  # 0.25% commission

                dt = datetime(d.year, d.month, d.day, hour, int(rng.integers(0, 59)),
                               tzinfo=timezone.utc)

                rows.append({
                    "business_id": cfg["id"],
                    "location_type": cfg["location_type"],
                    "is_haat_day": int(is_haat and d.weekday() in (0, 3)),
                    "date": d.isoformat(),
                    "hour": hour,
                    "dow": d.weekday(),
                    "is_weekend_bd": int(d.weekday() in (4, 5)),
                    "day_of_month": d.day,
                    "month": d.month,
                    "is_month_end": int(d.day >= 25),
                    "is_salary_week": int(is_salary_week),
                    "is_remittance_surge": int(d.day in (1, 15)),
                    "is_ramadan": int(RAMADAN_START_OFFSET <= i < RAMADAN_START_OFFSET + RAMADAN_LENGTH),
                    "is_eid_window": int(
                        abs(i - EID_FITR_OFFSET) <= 7 or abs(i - EID_ADHA_OFFSET) <= 7
                    ),
                    "cash_in_minor": max(0, cash_in),
                    "cash_out_minor": max(0, cash_out),
                    "send_money_minor": max(0, send_money),
                    "commission_minor": max(0, commission),
                    "net_cash_demand_minor": max(0, cash_out) - max(0, cash_in),
                    "efloat_demand_minor": max(0, cash_out) + max(0, send_money),
                })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(seed: int = SEED, n_days: int = 180, out_dir: Optional[Path] = None) -> None:
    out = out_dir or DATA_DIR
    out.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(seed)
    end_date = date.today()

    print(f"Generating {n_days} days of merchant data (seed={seed}) ...")
    merchant_df = generate_merchant_data(rng, end_date, n_days)
    merchant_path = out / "synthetic_merchant.parquet"
    merchant_df.to_parquet(merchant_path, index=False)
    print(f"  -> {merchant_path} ({len(merchant_df):,} rows)")

    print(f"Generating {n_days} days of agent hourly data ...")
    agent_df = generate_agent_data(rng, end_date, n_days)
    agent_path = out / "synthetic_agent_hourly.parquet"
    agent_df.to_parquet(agent_path, index=False)
    print(f"  -> {agent_path} ({len(agent_df):,} rows)")

    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--days", type=int, default=180)
    args = parser.parse_args()
    main(seed=args.seed, n_days=args.days)
