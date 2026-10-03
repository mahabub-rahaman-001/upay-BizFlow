"""Tests for baseline models."""
from app.ml.baselines import (
    last_value,
    mean_7d,
    seasonal_naive,
    seasonal_mean_4w,
    trend_seasonal,
    quantile_band,
    best_baseline_wape,
)


SERIES_28 = [100_000 + i * 1000 for i in range(28)]


def test_last_value():
    assert last_value(SERIES_28) == SERIES_28[-1]
    assert last_value([]) == 0


def test_mean_7d():
    result = mean_7d(SERIES_28)
    expected = sum(SERIES_28[-7:]) // 7
    assert abs(result - expected) <= 1


def test_seasonal_naive():
    assert seasonal_naive(SERIES_28) == SERIES_28[-7]


def test_seasonal_mean_4w():
    result = seasonal_mean_4w(SERIES_28, dow=0)
    assert result > 0


def test_trend_seasonal():
    result = trend_seasonal(SERIES_28)
    assert result > 0


def test_quantile_band():
    p10, p50, p90 = quantile_band(SERIES_28)
    assert p10 <= p50 <= p90


def test_wape_perfect_prediction():
    actuals = [100_000, 200_000, 150_000]
    assert best_baseline_wape(actuals, actuals) == 0.0


def test_wape_empty():
    import math
    assert math.isinf(best_baseline_wape([], []))
