"""AI-04: Transaction anomaly detector (docs/08 section 8).

POST /v1/anomaly/score
{
  "business_id": "uuid",
  "transactions": [...],
  "daily_vector": {optional per-day aggregates for IsolationForest}
}

Three layers:
1. Rules (deterministic)
2. Robust z-score (median/MAD) -- statistical
3. IsolationForest (ML, on per-day feature vector)

Output label: ALWAYS "needs_review" -- never "fraud".
"""
from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

try:
    from sklearn.ensemble import IsolationForest
    SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover
    SKLEARN_AVAILABLE = False

router = APIRouter()

# ---------------------------------------------------------------------------
# Bangla reason codes (docs/08 section 7 reason table)
# ---------------------------------------------------------------------------

REASON_BN = {
    "DUPLICATE_PAYMENT":   "একই পরিমাণ ও পেয়ার ৬০ সেকেন্ডের মধ্যে",
    "LARGE_AMOUNT":        "স্বাভাবিকের চেয়ে অনেক বড় পরিমাণ",
    "OUTSIDE_HOURS":       "ব্যবসার সময়ের বাইরে",
    "HIGH_REFUND":         "অস্বাভাবিক বেশি রিফান্ড",
    "REPEATED_REVERSAL":   "একই কর্মীর বারবার বাতিল",
    "VARIANCE_STREAK":     "টানা কয়েকদিন হিসাবে পার্থক্য",
    "STATISTICAL_OUTLIER": "পরিসংখ্যানগতভাবে অস্বাভাবিক",
    "ML_ANOMALY":          "ML মডেল সন্দেহজনক চিহ্নিত করেছে",
}

ALERT_BUDGET_PER_WEEK = 2   # target <= 2 alerts/business/week (pilot)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TxnAnomalyIn(BaseModel):
    id: str
    amount_minor: int
    kind: str
    source: str
    occurred_at: str
    actor_user_id: Optional[str] = None
    payer_hash: Optional[str] = None
    category: Optional[str] = None

    # Context passed by caller (pre-computed from ledger)
    amount_p99_minor: Optional[int] = None          # p99 of business last 90d
    opening_hour: Optional[int] = None              # business opening hour (0-23)
    closing_hour: Optional[int] = None              # business closing hour (0-23)
    refund_30d_mean_minor: Optional[int] = None     # daily mean refund last 30d
    actor_reversal_count_7d: Optional[int] = None   # reversals by this actor last 7d
    closing_variance_streak: Optional[int] = None   # consecutive days with |variance| > tolerance


class DailyVector(BaseModel):
    """Optional per-day aggregates for IsolationForest. If omitted, ML layer skipped."""
    txn_count: int = 0
    refund_count: int = 0
    manual_count: int = 0
    late_night_share: float = 0.0
    cash_mix: float = 0.0
    split_txn_score: float = 0.0
    variance_minor: int = 0
    reversal_rate: float = 0.0


class AnomalyRequest(BaseModel):
    business_id: str
    transactions: list[TxnAnomalyIn]
    daily_vector: Optional[DailyVector] = None
    # Historical daily vectors for fitting IsolationForest (last 90 days)
    history_vectors: Optional[list[DailyVector]] = None


class AnomalyResult(BaseModel):
    txn_id: str
    score: float          # 0.0 – 1.0; higher = more anomalous
    label: str            # always "needs_review"
    reason_codes: list[str]
    reason_bn: list[str]


class AnomalyResponse(BaseModel):
    business_id: str
    results: list[AnomalyResult]
    day_anomaly: Optional[float] = None  # IsolationForest score for the day vector


# ---------------------------------------------------------------------------
# Rule layer
# ---------------------------------------------------------------------------

def _rule_flags(txn: TxnAnomalyIn, all_txns: list[TxnAnomalyIn]) -> list[str]:
    codes: list[str] = []

    try:
        occurred = datetime.fromisoformat(txn.occurred_at)
    except Exception:
        occurred = None

    # DUPLICATE: same amount + same payer_hash within 60 s
    if txn.payer_hash:
        for other in all_txns:
            if other.id == txn.id:
                continue
            if other.amount_minor != txn.amount_minor:
                continue
            if other.payer_hash != txn.payer_hash:
                continue
            try:
                other_occ = datetime.fromisoformat(other.occurred_at)
                if occurred and abs((occurred - other_occ).total_seconds()) <= 60:
                    codes.append("DUPLICATE_PAYMENT")
                    break
            except Exception:
                pass

    # LARGE_AMOUNT: > 5 × p99
    if txn.amount_p99_minor and txn.amount_minor > 5 * txn.amount_p99_minor:
        codes.append("LARGE_AMOUNT")

    # OUTSIDE_HOURS
    if occurred and txn.opening_hour is not None and txn.closing_hour is not None:
        h = occurred.hour
        if txn.opening_hour <= txn.closing_hour:
            if not (txn.opening_hour <= h <= txn.closing_hour):
                codes.append("OUTSIDE_HOURS")
        else:  # overnight business
            if txn.closing_hour < h < txn.opening_hour:
                codes.append("OUTSIDE_HOURS")

    # HIGH_REFUND: refund > 3 × 30d daily mean
    if txn.kind in ("REFUND",) and txn.refund_30d_mean_minor:
        if txn.amount_minor > 3 * txn.refund_30d_mean_minor:
            codes.append("HIGH_REFUND")

    # REPEATED_REVERSAL
    if txn.kind == "REVERSAL" and txn.actor_reversal_count_7d is not None:
        if txn.actor_reversal_count_7d >= 3:
            codes.append("REPEATED_REVERSAL")

    # VARIANCE_STREAK
    if txn.closing_variance_streak is not None and txn.closing_variance_streak >= 3:
        codes.append("VARIANCE_STREAK")

    return codes


# ---------------------------------------------------------------------------
# Statistical layer: robust z-score
# ---------------------------------------------------------------------------

def _robust_zscore_flags(txn: TxnAnomalyIn, all_txns: list[TxnAnomalyIn]) -> list[str]:
    """Flag if txn amount is a statistical outlier for its kind via MAD z-score."""
    same_kind = [t.amount_minor for t in all_txns if t.kind == txn.kind]
    if len(same_kind) < 5:
        return []
    med = statistics.median(same_kind)
    mad = statistics.median([abs(v - med) for v in same_kind])
    if mad == 0:
        return []
    z = (txn.amount_minor - med) / (1.4826 * mad)
    if abs(z) > 3.5:
        return ["STATISTICAL_OUTLIER"]
    return []


# ---------------------------------------------------------------------------
# ML layer: IsolationForest on per-day vector
# ---------------------------------------------------------------------------

def _isolation_forest_score(
    today: DailyVector,
    history: list[DailyVector],
) -> float:
    """Return anomaly score (0=normal … 1=anomalous) using IsolationForest."""
    if not SKLEARN_AVAILABLE or len(history) < 20:
        return 0.0

    def _vec(dv: DailyVector) -> list[float]:
        return [
            float(dv.txn_count),
            float(dv.refund_count),
            float(dv.manual_count),
            float(dv.late_night_share),
            float(dv.cash_mix),
            float(dv.split_txn_score),
            float(abs(dv.variance_minor)),
            float(dv.reversal_rate),
        ]

    X_hist = np.array([_vec(dv) for dv in history])
    X_today = np.array([_vec(today)])

    clf = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
    clf.fit(X_hist)

    # decision_function: lower = more anomalous; map to [0, 1]
    raw = clf.decision_function(X_today)[0]
    # Typical range [-0.5, 0.5]; normalize and invert
    score = float(np.clip(0.5 - raw, 0.0, 1.0))
    return round(score, 4)


# ---------------------------------------------------------------------------
# Score aggregation
# ---------------------------------------------------------------------------

def _aggregate_score(rule_codes: list[str], stat_codes: list[str], ml_score: float) -> float:
    """Combine rule, statistical, and ML signals into a single [0, 1] score."""
    score = 0.0
    score += min(0.6, len(rule_codes) * 0.25)
    score += min(0.2, len(stat_codes) * 0.20)
    score += ml_score * 0.20
    return round(min(1.0, score), 4)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

@router.post("/anomaly/score", response_model=AnomalyResponse)
def anomaly_score(req: AnomalyRequest) -> AnomalyResponse:
    results: list[AnomalyResult] = []

    # Day-level IsolationForest
    day_score: Optional[float] = None
    if req.daily_vector and req.history_vectors:
        day_score = _isolation_forest_score(req.daily_vector, req.history_vectors)

    for txn in req.transactions:
        rule_codes  = _rule_flags(txn, req.transactions)
        stat_codes  = _robust_zscore_flags(txn, req.transactions)
        ml_codes: list[str] = ["ML_ANOMALY"] if (day_score is not None and day_score > 0.7) else []

        all_codes = rule_codes + stat_codes + ml_codes
        # De-duplicate preserving order
        seen: set[str] = set()
        unique_codes: list[str] = []
        for c in all_codes:
            if c not in seen:
                seen.add(c)
                unique_codes.append(c)

        score = _aggregate_score(rule_codes, stat_codes, day_score or 0.0)
        bn_labels = [REASON_BN.get(c, c) for c in unique_codes]

        results.append(AnomalyResult(
            txn_id=txn.id,
            score=score,
            label="needs_review",   # ALWAYS -- never "fraud"
            reason_codes=unique_codes,
            reason_bn=bn_labels,
        ))

    return AnomalyResponse(
        business_id=req.business_id,
        results=results,
        day_anomaly=day_score,
    )
