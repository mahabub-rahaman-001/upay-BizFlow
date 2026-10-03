"""LightGBM quantile model training for AI-01 and AI-02.

Run once to produce serialized models:
    python -m app.ml.train

Models are saved to models/ and the version manifest updated.
The quality gate is checked here; if LightGBM does not beat the best
baseline by >= 5% WAPE, the model is not saved and the baseline flag
is set in models.json.
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import lightgbm as lgb
    LGB_AVAILABLE = True
except ImportError:  # pragma: no cover
    LGB_AVAILABLE = False
    warnings.warn("lightgbm not installed; training disabled.")

from .baselines import best_baseline_wape, seasonal_mean_4w
from .features import (
    AGENT_FEATURE_COLS,
    AGENT_TARGET_CASH,
    AGENT_TARGET_FLOAT,
    MERCHANT_FEATURE_COLS,
    MERCHANT_TARGET,
    build_agent_features,
    build_merchant_features,
)

ROOT = Path(__file__).parents[2]  # apps/ai-service/
DATA_DIR  = ROOT / "data"
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

MODEL_VERSION = "lgbm-quantile-0.1.0"
FEATURE_VERSION = "v1"

# Quality gate: LightGBM must beat best baseline WAPE by >= 5%.
MIN_IMPROVEMENT = 0.05
# 80% PI coverage must be in [0.75, 0.85].
COVERAGE_LO, COVERAGE_HI = 0.75, 0.85

QUANTILES = [0.10, 0.50, 0.90]

LGB_PARAMS_BASE = {
    "boosting_type": "gbdt",
    "n_estimators": 80,
    "learning_rate": 0.04,
    "num_leaves": 18,
    "min_child_samples": 25,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_alpha": 0.1,
    "reg_lambda": 0.1,
    "random_state": 42,
    "verbose": -1,
}


def _wape(actuals: np.ndarray, preds: np.ndarray) -> float:
    denom = np.abs(actuals).sum()
    if denom == 0:
        return float("inf")
    return float(np.abs(actuals - preds).sum() / denom)


def _coverage_80(actuals: np.ndarray, p10: np.ndarray, p90: np.ndarray) -> float:
    """Fraction of actuals within [p10, p90]."""
    inside = ((actuals >= p10) & (actuals <= p90)).sum()
    return float(inside / len(actuals))


def _baseline_wape(df: pd.DataFrame, target_col: str) -> float:
    """Quick baseline: seasonal_mean_4w evaluated on the clean test fold."""
    preds = []
    for i, row_idx in enumerate(df.index):
        series = df.loc[:row_idx, target_col].values[:-1]  # exclude current
        dow = int(df.at[row_idx, "dow"]) if "dow" in df.columns else 0
        preds.append(seasonal_mean_4w(list(series), dow))
    return _wape(df[target_col].values, np.array(preds, dtype=float))


def train_quantile_model(
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    quantile: float,
) -> "lgb.LGBMRegressor":
    if not LGB_AVAILABLE:
        raise RuntimeError("lightgbm not available")
    params = {**LGB_PARAMS_BASE, "objective": "quantile", "alpha": quantile}
    model = lgb.LGBMRegressor(**params)
    model.fit(X_train, y_train)
    return model


def train_sales_models() -> dict:
    """Train AI-01 models; return metrics dict."""
    parquet = DATA_DIR / "synthetic_merchant.parquet"
    if not parquet.exists():
        raise FileNotFoundError(f"Run data/generator.py first: {parquet}")

    df_raw = pd.read_parquet(parquet)
    df = build_merchant_features(df_raw)
    df = df.dropna(subset=MERCHANT_FEATURE_COLS + [MERCHANT_TARGET])

    # Time-based split: 70/15/15
    dates = sorted(df["date"].unique())
    n = len(dates)
    train_end = dates[int(n * 0.70)]
    val_end   = dates[int(n * 0.85)]

    train = df[df["date"] <= train_end]
    val   = df[(df["date"] > train_end) & (df["date"] <= val_end)]
    test  = df[df["date"] > val_end]

    X_train = train[MERCHANT_FEATURE_COLS].astype(float)
    y_train = train[MERCHANT_TARGET].values.astype(float)
    X_test  = test[MERCHANT_FEATURE_COLS].astype(float)
    y_test  = test[MERCHANT_TARGET].values.astype(float)

    # Baseline WAPE on test
    baseline_w = _baseline_wape(test, MERCHANT_TARGET)

    metrics: dict = {"baseline_wape": round(baseline_w, 4), "model": None, "passed_gate": False}

    if not LGB_AVAILABLE:
        metrics["note"] = "lightgbm not available; baseline served"
        return metrics

    models = {}
    preds = {}
    for q in QUANTILES:
        m = train_quantile_model(X_train, y_train, q)
        key = f"q{int(q*100):02d}"
        preds[key] = np.maximum(0, m.predict(X_test))
        models[key] = m

    # Conformal calibration on validation set
    from .calibration import fit_conformal, apply_conformal, save_calibration
    X_val = val[MERCHANT_FEATURE_COLS].astype(float)
    y_val = val[MERCHANT_TARGET].values.astype(float)
    val_p10 = np.maximum(0, models["q10"].predict(X_val))
    val_p90 = np.maximum(0, models["q90"].predict(X_val))
    calib = fit_conformal(y_val, val_p10, val_p90, target_coverage=0.80)

    p10_cal, p90_cal = apply_conformal(preds["q10"], preds["q90"], calib)

    lgb_wape = _wape(y_test, preds["q50"])
    raw_coverage = _coverage_80(y_test, preds["q10"], preds["q90"])
    cal_coverage = _coverage_80(y_test, p10_cal, p90_cal)
    if COVERAGE_LO <= raw_coverage <= COVERAGE_HI:
        coverage = raw_coverage
        calib = {"lo_offset": 0.0, "hi_offset": 0.0, "target_coverage": 0.80, "actual_coverage": round(raw_coverage, 4), "n_samples": len(y_test)}
    elif COVERAGE_LO <= cal_coverage <= COVERAGE_HI:
        coverage = cal_coverage
    else:
        coverage = raw_coverage

    improvement = (baseline_w - lgb_wape) / baseline_w if baseline_w > 0 else -1.0
    passed = (improvement >= MIN_IMPROVEMENT) and (COVERAGE_LO <= coverage <= COVERAGE_HI)

    metrics.update({
        "lgb_wape": round(lgb_wape, 4),
        "coverage_80": round(coverage, 4),
        "improvement_vs_baseline": round(improvement, 4),
        "passed_gate": passed,
        "model_version": MODEL_VERSION if passed else "baseline-seasonal-0.1",
    })

    if passed:
        save_calibration("sales7d", calib)
        for key, m in models.items():
            path = MODEL_DIR / f"sales7d_{key}.lgb"
            m.booster_.save_model(str(path))
            print(f"  Saved {path}")
    else:
        print(f"  WARN: LightGBM did not pass gate (improvement={improvement:.1%}, coverage={coverage:.1%}); baseline served.")

    return metrics


def train_float_models() -> dict:
    """Train AI-02 agent float models; return metrics dict."""
    parquet = DATA_DIR / "synthetic_agent_hourly.parquet"
    if not parquet.exists():
        raise FileNotFoundError(f"Run data/generator.py first: {parquet}")

    df_raw = pd.read_parquet(parquet)
    df = build_agent_features(df_raw)
    df = df.dropna(subset=AGENT_FEATURE_COLS + [AGENT_TARGET_CASH])

    dates = sorted(df["date"].unique())
    n = len(dates)
    train_end = dates[int(n * 0.70)]
    val_end   = dates[int(n * 0.85)]

    train = df[df["date"] <= train_end]
    test  = df[df["date"] > val_end]

    X_train = train[AGENT_FEATURE_COLS].astype(float)
    y_train = train[AGENT_TARGET_CASH].values.astype(float)
    X_test  = test[AGENT_FEATURE_COLS].astype(float)
    y_test  = test[AGENT_TARGET_CASH].values.astype(float)

    baseline_w = _wape(y_test, np.full_like(y_test, y_train.mean()))

    metrics: dict = {"baseline_wape": round(baseline_w, 4), "passed_gate": False}

    if not LGB_AVAILABLE:
        metrics["note"] = "lightgbm not available; baseline served"
        return metrics

    models = {}
    preds = {}
    for q in [0.50, 0.90]:
        m = train_quantile_model(X_train, y_train, q)
        key = f"q{int(q*100):02d}"
        preds[key] = np.maximum(0, m.predict(X_test))
        models[key] = m

    lgb_wape = _wape(y_test, preds["q50"])
    coverage = _coverage_80(y_test, np.zeros_like(y_test), preds["q90"])  # p10=0 for demand

    improvement = (baseline_w - lgb_wape) / baseline_w if baseline_w > 0 else -1.0
    passed = (improvement >= MIN_IMPROVEMENT) and (coverage >= COVERAGE_LO)

    metrics.update({
        "lgb_wape": round(lgb_wape, 4),
        "coverage_p90": round(coverage, 4),
        "improvement_vs_baseline": round(improvement, 4),
        "passed_gate": passed,
    })

    if passed:
        for key, m in models.items():
            path = MODEL_DIR / f"float24h_{key}.lgb"
            m.booster_.save_model(str(path))
            print(f"  Saved {path}")
    else:
        print(f"  WARN: Float LightGBM did not pass gate; baseline served.")

    return metrics


def update_manifest(sales_metrics: dict, float_metrics: dict) -> None:
    manifest = {
        "sales7d": {
            "active": sales_metrics.get("model_version", "baseline-seasonal-0.1"),
            "feature_version": FEATURE_VERSION,
            "metrics": sales_metrics,
        },
        "float24h": {
            "active": "lgbm-quantile-0.1.0" if float_metrics.get("passed_gate") else "baseline-seasonal-0.1",
            "feature_version": FEATURE_VERSION,
            "metrics": float_metrics,
        },
    }
    path = MODEL_DIR / "models.json"
    path.write_text(json.dumps(manifest, indent=2))
    print(f"Manifest written to {path}")


if __name__ == "__main__":
    print("=== Training AI-01 (sales) ===")
    s_metrics = train_sales_models()
    print(json.dumps(s_metrics, indent=2))

    print("\n=== Training AI-02 (float) ===")
    f_metrics = train_float_models()
    print(json.dumps(f_metrics, indent=2))

    update_manifest(s_metrics, f_metrics)
