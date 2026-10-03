"""Five deterministic baselines for AI-01 and AI-02 (docs/08 section 4.3).

These are always computed and are the fallback when the LightGBM model
does not beat them on the quality gate (docs/08 section 4.3 selection rule).
"""
from __future__ import annotations

import math
import statistics
from typing import Sequence


def last_value(series: Sequence[int]) -> int:
    """Baseline B1: most recent observed value."""
    if not series:
        return 0
    return series[-1]


def mean_7d(series: Sequence[int]) -> int:
    """Baseline B2: 7-day rolling mean."""
    recent = list(series)[-7:]
    return int(statistics.mean(recent)) if recent else 0


def seasonal_naive(series: Sequence[int], horizon: int = 1) -> int:
    """Baseline B3: same weekday last week (series is daily, 0-indexed by day)."""
    idx = len(series) - 7 * horizon
    if idx < 0:
        return mean_7d(series)
    return series[idx]


def seasonal_mean_4w(series: Sequence[int], dow: int) -> int:
    """Baseline B4: mean of last 4 occurrences of the same day-of-week.

    series -- daily values chronological
    dow    -- target day-of-week (0=Mon … 6=Sun)
    """
    # Walk backwards collecting up to 4 same-dow values.
    n = len(series)
    samples: list[int] = []
    for i in range(n - 1, -1, -1):
        # day-of-week of series[i] = (start_dow + i) % 7, but we don't
        # know start_dow here. The caller should pass a sliced series where
        # position 0 corresponds to a known weekday; we derive offset from
        # the tail which is the cutoff day minus i days.
        # Simpler: accept that the caller knows only whether (n-1-i) % 7 == 0
        # means same weekday as today (horizon 1 → same weekday as D+1).
        days_back = n - 1 - i
        if days_back > 0 and days_back % 7 == 0:
            samples.append(series[i])
        if len(samples) == 4:
            break
    if not samples:
        return mean_7d(series)
    return int(statistics.mean(samples))


def trend_seasonal(series: Sequence[int]) -> int:
    """Baseline B5: linear trend + same-weekday seasonal component.

    Fits a simple OLS trend on the last 28 days, then adjusts the
    4-week same-weekday mean by the projected trend increment.
    """
    tail = list(series)[-28:]
    n = len(tail)
    if n < 7:
        return mean_7d(series)

    # OLS slope
    xs = list(range(n))
    x_mean = statistics.mean(xs)
    y_mean = statistics.mean(tail)
    num = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, tail))
    den = sum((x - x_mean) ** 2 for x in xs)
    slope = num / den if den else 0.0

    # Same-weekday mean (last 4)
    base = seasonal_mean_4w(tail, dow=0)  # dow placeholder -- we use the 7-stride rule inside
    adjusted = int(base + slope * 7)
    return max(0, adjusted)


def quantile_band(series: Sequence[int], alpha: float = 0.8) -> tuple[int, int, int]:
    """Return (p10, p50, p90) from a series, used as baseline interval.

    For baselines the interval is wider than LightGBM conformal intervals.
    """
    if not series:
        return 0, 0, 0
    sorted_vals = sorted(series)
    n = len(sorted_vals)
    lo = alpha / 2          # 0.10
    hi = 1 - lo             # 0.90

    def _pct(p: float) -> int:
        idx = p * (n - 1)
        lo_i = int(idx)
        hi_i = min(lo_i + 1, n - 1)
        return int(sorted_vals[lo_i] + (idx - lo_i) * (sorted_vals[hi_i] - sorted_vals[lo_i]))

    return _pct(1 - hi), _pct(0.5), _pct(hi)


def best_baseline_wape(actuals: Sequence[int], predictions: Sequence[int]) -> float:
    """Weighted Absolute Percentage Error (WAPE = MAE / mean(actuals))."""
    if not actuals or not predictions:
        return float("inf")
    total_actual = sum(abs(a) for a in actuals)
    if total_actual == 0:
        return float("inf")
    total_error = sum(abs(a - p) for a, p in zip(actuals, predictions))
    return total_error / total_actual
