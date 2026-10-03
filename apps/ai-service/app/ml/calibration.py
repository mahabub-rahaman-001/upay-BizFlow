"""Conformal calibration for LightGBM quantile models (docs/08 section 4.3).

Split-conformal adjustment: fit adjustment offsets on the validation residuals
so that empirical 80% interval coverage ~= 80%.

Usage (called from train.py after model fitting):
    from app.ml.calibration import fit_conformal, apply_conformal
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import numpy as np

CALIBRATION_PATH = Path(__file__).parents[2] / "models" / "calibration.json"


def fit_conformal(
    actuals: np.ndarray,
    p10_preds: np.ndarray,
    p90_preds: np.ndarray,
    target_coverage: float = 0.80,
) -> dict:
    """Compute conformal offsets for the 80% prediction interval.

    Returns offsets: lo_offset (add to p10) and hi_offset (add to p90).
    The signs are chosen so that post-calibration coverage ~= target_coverage.
    """
    n = len(actuals)
    # Non-conformity scores: how much each actual falls outside the current interval.
    lo_scores = p10_preds - actuals          # positive when actual < p10 (too narrow low)
    hi_scores = actuals - p90_preds          # positive when actual > p90 (too narrow high)
    nc_scores = np.maximum(lo_scores, hi_scores)  # worst violation

    # Quantile of non-conformity scores at (1 - alpha) * (1 + 1/n).
    alpha = 1.0 - target_coverage
    q_level = min(1.0, (1 - alpha) * (1 + 1 / n))
    offset = float(np.quantile(nc_scores, q_level))

    # Coverage verification
    covered = int(((actuals >= p10_preds - offset) & (actuals <= p90_preds + offset)).sum())
    actual_coverage = covered / n

    return {
        "lo_offset": -offset,    # subtract from p10 to widen interval
        "hi_offset": offset,     # add to p90 to widen interval
        "target_coverage": target_coverage,
        "actual_coverage": round(actual_coverage, 4),
        "n_samples": n,
    }


def apply_conformal(
    p10: np.ndarray,
    p90: np.ndarray,
    calibration: dict,
) -> tuple[np.ndarray, np.ndarray]:
    """Apply stored conformal offsets to model predictions."""
    lo = calibration.get("lo_offset", 0.0)
    hi = calibration.get("hi_offset", 0.0)
    p10_cal = np.maximum(0, p10 + lo)
    p90_cal = np.maximum(p10_cal, p90 + hi)
    return p10_cal, p90_cal


def save_calibration(model_key: str, calibration: dict) -> None:
    """Persist calibration for a model key to calibration.json."""
    CALIBRATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing: dict = {}
    if CALIBRATION_PATH.exists():
        existing = json.loads(CALIBRATION_PATH.read_text())
    existing[model_key] = calibration
    CALIBRATION_PATH.write_text(json.dumps(existing, indent=2))


def load_calibration(model_key: str) -> Optional[dict]:
    """Load calibration for a model key; returns None if not found."""
    if not CALIBRATION_PATH.exists():
        return None
    data = json.loads(CALIBRATION_PATH.read_text())
    return data.get(model_key)
