"""Rolling-origin backtest for AI-01 and AI-02 (docs/08 section 12).

7 folds, time-based. Produces metrics_table.json used by CI quality gate.

Run:
    python -m notebooks.evaluate
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from app.ml.baselines import (
    best_baseline_wape,
    last_value,
    mean_7d,
    seasonal_naive,
    seasonal_mean_4w,
    trend_seasonal,
)
from app.ml.features import (
    MERCHANT_FEATURE_COLS,
    MERCHANT_TARGET,
    build_merchant_features,
)

ROOT = Path(__file__).parent.parent
DATA_DIR  = ROOT / "data"
MODEL_DIR = ROOT / "models"

N_FOLDS = 7
METRICS_PATH = MODEL_DIR / "metrics_table.json"


def _wape(actuals: np.ndarray, preds: np.ndarray) -> float:
    denom = np.abs(actuals).sum()
    if denom == 0:
        return float("inf")
    return float(np.abs(actuals - preds).sum() / denom)


def _mae(actuals: np.ndarray, preds: np.ndarray) -> float:
    return float(np.abs(actuals - preds).mean())


def _bias(actuals: np.ndarray, preds: np.ndarray) -> float:
    return float((preds - actuals).mean() / (np.abs(actuals).mean() + 1e-9))


def _coverage_80(actuals: np.ndarray, p10: np.ndarray, p90: np.ndarray) -> float:
    return float(((actuals >= p10) & (actuals <= p90)).mean())


# ---------------------------------------------------------------------------
# Baseline predictions on a slice
# ---------------------------------------------------------------------------

def _predict_baselines(train_df: pd.DataFrame, test_df: pd.DataFrame) -> dict[str, np.ndarray]:
    """Return a dict of baseline predictions for each test row."""
    preds: dict[str, list[int]] = {
        "last_value": [],
        "mean_7d": [],
        "seasonal_naive": [],
        "seasonal_mean_4w": [],
        "trend_seasonal": [],
    }

    for _, row in test_df.iterrows():
        bid = row["business_id"]
        test_date = row["date"]
        hist_series = (
            train_df[train_df["business_id"] == bid]
            .sort_values("date")[MERCHANT_TARGET]
            .tolist()
        )
        dow = int(pd.Timestamp(test_date).weekday())

        preds["last_value"].append(last_value(hist_series))
        preds["mean_7d"].append(mean_7d(hist_series))
        preds["seasonal_naive"].append(seasonal_naive(hist_series))
        preds["seasonal_mean_4w"].append(seasonal_mean_4w(hist_series, dow))
        preds["trend_seasonal"].append(trend_seasonal(hist_series))

    return {k: np.array(v, dtype=float) for k, v in preds.items()}


def run_backtest(df_full: pd.DataFrame) -> dict:
    """Run 7-fold rolling-origin backtest on merchant data."""
    dates = sorted(df_full["date"].unique())
    n_dates = len(dates)
    fold_size = n_dates // (N_FOLDS + 1)

    all_metrics: dict[str, list[float]] = {
        b: [] for b in ["last_value", "mean_7d", "seasonal_naive", "seasonal_mean_4w", "trend_seasonal"]
    }

    try:
        import lightgbm as lgb
        lgb_available = True
    except ImportError:
        lgb_available = False

    lgb_wapes: list[float] = []
    lgb_coverages: list[float] = []

    for fold in range(N_FOLDS):
        train_end_idx = (fold + 1) * fold_size
        test_start_idx = train_end_idx
        test_end_idx = min(test_start_idx + fold_size, n_dates)

        if test_start_idx >= n_dates:
            break

        train_dates = dates[:train_end_idx]
        test_dates  = dates[test_start_idx:test_end_idx]

        train_df = df_full[df_full["date"].isin(train_dates)]
        test_df  = df_full[df_full["date"].isin(test_dates)]

        if len(test_df) == 0:
            continue

        actuals = test_df[MERCHANT_TARGET].values.astype(float)

        # Baselines
        baseline_preds = _predict_baselines(train_df, test_df)
        for name, preds in baseline_preds.items():
            wape = _wape(actuals, preds)
            all_metrics[name].append(wape)

        # LightGBM (if models exist)
        if lgb_available:
            m10_path = MODEL_DIR / "sales7d_q10.lgb"
            m50_path = MODEL_DIR / "sales7d_q50.lgb"
            m90_path = MODEL_DIR / "sales7d_q90.lgb"
            if m10_path.exists() and m50_path.exists() and m90_path.exists():
                m10 = lgb.Booster(model_file=str(m10_path))
                m50 = lgb.Booster(model_file=str(m50_path))
                m90 = lgb.Booster(model_file=str(m90_path))

                feat_df = build_merchant_features(
                    pd.concat([train_df, test_df], ignore_index=True)
                )
                test_feat = feat_df[feat_df["date"].isin(test_dates)]
                if len(test_feat) > 0:
                    X_test = test_feat[MERCHANT_FEATURE_COLS].astype(float)
                    p10 = np.maximum(0, m10.predict(X_test))
                    p50 = np.maximum(0, m50.predict(X_test))
                    p90 = np.maximum(0, m90.predict(X_test))
                    lgb_wapes.append(_wape(actuals[:len(p50)], p50))
                    lgb_coverages.append(_coverage_80(actuals[:len(p10)], p10, p90))

    # Aggregate
    metrics_table: dict = {}
    for name, wapes in all_metrics.items():
        if wapes:
            metrics_table[name] = {
                "wape": round(float(np.mean(wapes)), 4),
                "note": "baseline",
            }

    if lgb_wapes:
        metrics_table["lightgbm_quantile"] = {
            "wape": round(float(np.mean(lgb_wapes)), 4),
            "pi_coverage_80": round(float(np.mean(lgb_coverages)), 4),
            "note": "candidate",
        }

    return metrics_table


def main() -> None:
    parquet = DATA_DIR / "synthetic_merchant.parquet"
    if not parquet.exists():
        raise FileNotFoundError("Run data/generator.py first.")

    df = pd.read_parquet(parquet)
    df["date"] = pd.to_datetime(df["date"])

    print(f"Running {N_FOLDS}-fold rolling-origin backtest on {len(df):,} rows ...")
    metrics = run_backtest(df)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    METRICS_PATH.write_text(json.dumps(metrics, indent=2))
    print(f"\nMetrics table written to {METRICS_PATH}")
    print(json.dumps(metrics, indent=2))

    # Print comparison table
    baselines = ["last_value", "mean_7d", "seasonal_naive", "seasonal_mean_4w", "trend_seasonal"]
    print("\n--- Baseline comparison table (docs/08 section 12.3) ---")
    print(f"{'Model':<30} {'WAPE':>8} {'PI Coverage':>12} {'Note'}")
    print("-" * 65)
    for name in baselines:
        m = metrics.get(name, {})
        print(f"{name:<30} {m.get('wape', 'n/a'):>8} {'n/a':>12}  {m.get('note', '')}")
    if "lightgbm_quantile" in metrics:
        m = metrics["lightgbm_quantile"]
        print(f"{'lightgbm_quantile':<30} {m.get('wape', 'n/a'):>8} {m.get('pi_coverage_80', 'n/a'):>12}  {m.get('note', '')}")


if __name__ == "__main__":
    main()
