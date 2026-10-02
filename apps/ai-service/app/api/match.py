"""AI-03: Smart reconciliation match scorer (docs/08 section 7).

POST /v1/match/suggest
{
  "txn": {
    "id": "uuid",
    "amount_minor": 85000,
    "occurred_at": "2026-10-02T10:42:11+06:00",
    "reference": "INV-1048",
    "actor_user_id": "uuid",
    "payer_hash": "opaque-hash"
  },
  "candidates": [...]
}
"""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

# ---------------------------------------------------------------------------
# Thresholds (docs/08 section 7)
# ---------------------------------------------------------------------------

SUGGEST_THRESHOLD = 0.85   # score >= this AND margin >= 0.2 => "suggested"
MARGIN_THRESHOLD  = 0.20   # gap between top-1 and top-2 score

# Feature weights (logistic score — hackathon; replace with LambdaMART in production)
WEIGHTS = {
    "amount_exact":        2.00,
    "reference_exact":     2.00,
    "reference_sim":       0.80,
    "amount_rel_diff_inv": 0.60,  # 1 / (1 + rel_diff)
    "time_gap_inv":        0.40,  # 1 / (1 + hours)
    "same_staff":          0.30,
    "customer_repeat":     0.20,
    "age_inv":             0.10,  # 1 / (1 + age_days)
}
WEIGHT_TOTAL = sum(WEIGHTS.values())


# ---------------------------------------------------------------------------
# Jaro-Winkler similarity
# ---------------------------------------------------------------------------

def _jaro(s1: str, s2: str) -> float:
    if s1 == s2:
        return 1.0
    n1, n2 = len(s1), len(s2)
    if n1 == 0 or n2 == 0:
        return 0.0
    match_dist = max(n1, n2) // 2 - 1
    s1_matches = [False] * n1
    s2_matches = [False] * n2
    matches = 0
    transpositions = 0
    for i in range(n1):
        start = max(0, i - match_dist)
        end   = min(i + match_dist + 1, n2)
        for j in range(start, end):
            if s2_matches[j] or s1[i] != s2[j]:
                continue
            s1_matches[i] = s2_matches[j] = True
            matches += 1
            break
    if matches == 0:
        return 0.0
    k = 0
    for i in range(n1):
        if not s1_matches[i]:
            continue
        while not s2_matches[k]:
            k += 1
        if s1[i] != s2[k]:
            transpositions += 1
        k += 1
    return (matches / n1 + matches / n2 + (matches - transpositions / 2) / matches) / 3


def jaro_winkler(s1: str, s2: str, p: float = 0.1) -> float:
    j = _jaro(s1, s2)
    prefix = 0
    for c1, c2 in zip(s1, s2):
        if c1 == c2:
            prefix += 1
        else:
            break
        if prefix == 4:
            break
    return j + prefix * p * (1 - j)


def _normalize_ref(s: str) -> str:
    """Normalize Bangla/EN digits and strip whitespace."""
    if not s:
        return ""
    bn_map = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
    return re.sub(r"\s+", "", s.upper().translate(bn_map))


def _token_overlap(a: str, b: str) -> float:
    na, nb = _normalize_ref(a), _normalize_ref(b)
    if not na or not nb:
        return 0.0
    tokens_a = set(re.split(r"[^A-Z0-9]", na)) - {""}
    tokens_b = set(re.split(r"[^A-Z0-9]", nb)) - {""}
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TxnIn(BaseModel):
    id: str
    amount_minor: int
    occurred_at: str
    reference: Optional[str] = None
    actor_user_id: Optional[str] = None
    payer_hash: Optional[str] = None


class CandidateIn(BaseModel):
    id: str
    amount_minor: int
    occurred_at: str
    reference: Optional[str] = None
    actor_user_id: Optional[str] = None
    payer_hash: Optional[str] = None
    age_days: float = 0.0


class MatchRequest(BaseModel):
    txn: TxnIn
    candidates: list[CandidateIn]


class MatchResult(BaseModel):
    candidate_id: str
    score: float
    label: str   # "auto_match" | "suggested" | "review"
    reason: str


class MatchResponse(BaseModel):
    txn_id: str
    results: list[MatchResult]


# ---------------------------------------------------------------------------
# Scorer
# ---------------------------------------------------------------------------

def _score_pair(txn: TxnIn, cand: CandidateIn) -> tuple[float, str]:
    """Return (raw_score, reason_key)."""
    # Deterministic rule: exact reference + exact amount → auto-match
    if (
        txn.reference
        and cand.reference
        and _normalize_ref(txn.reference) == _normalize_ref(cand.reference)
        and txn.amount_minor == cand.amount_minor
    ):
        return 1.0, "exact_reference_and_amount"

    # Feature computation
    amount_diff = abs(txn.amount_minor - cand.amount_minor)
    rel_diff = amount_diff / max(txn.amount_minor, 1)
    amount_exact = 1.0 if amount_diff == 0 else 0.0

    ref_sim = jaro_winkler(
        _normalize_ref(txn.reference or ""),
        _normalize_ref(cand.reference or ""),
    )
    ref_token = _token_overlap(txn.reference or "", cand.reference or "")
    ref_best = max(ref_sim, ref_token)

    try:
        t1 = datetime.fromisoformat(txn.occurred_at)
        t2 = datetime.fromisoformat(cand.occurred_at)
        gap_hours = abs((t1 - t2).total_seconds()) / 3600.0
    except Exception:
        gap_hours = 72.0

    same_staff = 1.0 if (txn.actor_user_id and txn.actor_user_id == cand.actor_user_id) else 0.0
    customer_repeat = 1.0 if (txn.payer_hash and txn.payer_hash == cand.payer_hash) else 0.0

    # Weighted score (sigmoid-like normalization)
    raw = (
        WEIGHTS["amount_exact"]        * amount_exact +
        WEIGHTS["reference_sim"]       * ref_best +
        WEIGHTS["amount_rel_diff_inv"] * (1 / (1 + rel_diff)) +
        WEIGHTS["time_gap_inv"]        * (1 / (1 + gap_hours / 24)) +
        WEIGHTS["same_staff"]          * same_staff +
        WEIGHTS["customer_repeat"]     * customer_repeat +
        WEIGHTS["age_inv"]             * (1 / (1 + cand.age_days))
    )
    score = raw / WEIGHT_TOTAL
    reason = "amount_and_reference_match" if ref_best > 0.7 else "partial_match"
    return round(score, 4), reason


@router.post("/match/suggest", response_model=MatchResponse)
def match_suggest(req: MatchRequest) -> MatchResponse:
    if not req.candidates:
        return MatchResponse(txn_id=req.txn.id, results=[])

    scored = []
    for cand in req.candidates:
        score, reason = _score_pair(req.txn, cand)
        scored.append((cand.id, score, reason))

    scored.sort(key=lambda x: x[1], reverse=True)

    results: list[MatchResult] = []
    for rank, (cid, score, reason) in enumerate(scored):
        if score >= 1.0:
            label = "auto_match"
        elif (
            rank == 0
            and score >= SUGGEST_THRESHOLD
            and len(scored) > 1
            and (score - scored[1][1]) >= MARGIN_THRESHOLD
        ):
            label = "suggested"
        elif rank == 0 and score >= SUGGEST_THRESHOLD and len(scored) == 1:
            label = "suggested"
        else:
            label = "review"
        results.append(MatchResult(candidate_id=cid, score=score, label=label, reason=reason))

    return MatchResponse(txn_id=req.txn.id, results=results)
