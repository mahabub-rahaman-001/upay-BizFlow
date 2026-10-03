"""CI quality gate: LightGBM must beat best baseline by >= 5% WAPE (docs/08 section 4.3).

This test reads metrics_table.json produced by notebooks/evaluate.py.
If the file does not exist (models not yet trained), the test is skipped --
CI runs `python -m app.ml.train` before running tests.
"""
import json
import math
from pathlib import Path

import pytest

METRICS_PATH = Path(__file__).parents[1] / "models" / "metrics_table.json"
MIN_IMPROVEMENT = 0.05
COVERAGE_LO = 0.75
COVERAGE_HI = 0.85

BASELINES = ["last_value", "mean_7d", "seasonal_naive", "seasonal_mean_4w", "trend_seasonal"]


def _load() -> dict:
    if not METRICS_PATH.exists():
        pytest.skip("metrics_table.json not found; run notebooks/evaluate.py first")
    return json.loads(METRICS_PATH.read_text())


def test_metrics_table_has_baselines():
    metrics = _load()
    for b in BASELINES:
        assert b in metrics, f"Missing baseline '{b}' in metrics table"
        assert "wape" in metrics[b], f"Baseline '{b}' missing WAPE"
        assert 0 <= metrics[b]["wape"] <= 2, f"WAPE out of range for '{b}'"


def test_lightgbm_beats_baseline():
    metrics = _load()
    if "lightgbm_quantile" not in metrics:
        pytest.skip("LightGBM not trained yet; this gate enforced after training")

    lgb_wape = metrics["lightgbm_quantile"]["wape"]
    best_baseline_wape = min(metrics[b]["wape"] for b in BASELINES if b in metrics)
    if best_baseline_wape == 0:
        pytest.skip("Baseline WAPE is 0 -- degenerate test data")

    improvement = (best_baseline_wape - lgb_wape) / best_baseline_wape
    assert improvement >= MIN_IMPROVEMENT, (
        f"LightGBM WAPE {lgb_wape:.4f} must beat best baseline "
        f"{best_baseline_wape:.4f} by >={MIN_IMPROVEMENT:.0%}; "
        f"actual improvement: {improvement:.1%}"
    )


def test_interval_coverage_in_range():
    metrics = _load()
    if "lightgbm_quantile" not in metrics:
        pytest.skip("LightGBM not trained yet")

    cov = metrics["lightgbm_quantile"].get("pi_coverage_80")
    if cov is None:
        pytest.skip("pi_coverage_80 not in metrics")

    assert COVERAGE_LO <= cov <= COVERAGE_HI, (
        f"80% PI coverage {cov:.4f} must be in [{COVERAGE_LO}, {COVERAGE_HI}]"
    )


def test_no_nan_in_metrics():
    metrics = _load()
    for model, vals in metrics.items():
        for k, v in vals.items():
            if isinstance(v, float):
                assert not math.isnan(v), f"NaN in metrics[{model}][{k}]"
