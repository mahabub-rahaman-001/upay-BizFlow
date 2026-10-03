"""Tests for AI-04 anomaly detector."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

BID = "biz-001"

BASE_TXN = {
    "id": "txn-001",
    "amount_minor": 85000,
    "kind": "QR_PAYMENT",
    "source": "verified",
    "occurred_at": "2026-10-02T10:42:11+06:00",
    "amount_p99_minor": 500000,
    "opening_hour": 8,
    "closing_hour": 21,
}


def _req(txns, daily_vector=None, history_vectors=None):
    return {
        "business_id": BID,
        "transactions": txns,
        "daily_vector": daily_vector,
        "history_vectors": history_vectors,
    }


def test_normal_transaction_low_score():
    r = client.post("/v1/anomaly/score", json=_req([BASE_TXN]))
    assert r.status_code == 200
    result = r.json()["results"][0]
    assert result["score"] < 0.5
    # Label must ALWAYS be needs_review
    assert result["label"] == "needs_review"


def test_large_amount_flagged():
    txn = {**BASE_TXN, "id": "txn-002", "amount_minor": 3_000_000}  # > 5 * p99 (500k)
    r = client.post("/v1/anomaly/score", json=_req([txn]))
    result = r.json()["results"][0]
    assert "LARGE_AMOUNT" in result["reason_codes"]
    assert result["score"] > 0


def test_outside_hours_flagged():
    txn = {**BASE_TXN, "id": "txn-003", "occurred_at": "2026-10-02T02:30:00+06:00"}
    r = client.post("/v1/anomaly/score", json=_req([txn]))
    result = r.json()["results"][0]
    assert "OUTSIDE_HOURS" in result["reason_codes"]


def test_duplicate_payment_flagged():
    txns = [
        {**BASE_TXN, "id": "txn-004", "payer_hash": "hash-abc", "occurred_at": "2026-10-02T10:42:00+06:00"},
        {**BASE_TXN, "id": "txn-005", "payer_hash": "hash-abc", "occurred_at": "2026-10-02T10:42:30+06:00"},
    ]
    r = client.post("/v1/anomaly/score", json=_req(txns))
    results = r.json()["results"]
    codes_all = [c for res in results for c in res["reason_codes"]]
    assert "DUPLICATE_PAYMENT" in codes_all


def test_label_is_never_fraud():
    """Critical: label must always be needs_review."""
    # Use a very anomalous transaction
    txn = {
        **BASE_TXN,
        "id": "txn-006",
        "amount_minor": 10_000_000,     # huge
        "occurred_at": "2026-10-02T03:00:00+06:00",  # outside hours
        "amount_p99_minor": 100_000,
        "actor_reversal_count_7d": 10,
    }
    r = client.post("/v1/anomaly/score", json=_req([txn]))
    for result in r.json()["results"]:
        assert result["label"] == "needs_review"
        assert result["label"] != "fraud"


def test_bangla_reason_codes_present():
    txn = {**BASE_TXN, "id": "txn-007", "amount_minor": 5_000_000}
    r = client.post("/v1/anomaly/score", json=_req([txn]))
    result = r.json()["results"][0]
    if result["reason_codes"]:
        assert len(result["reason_bn"]) == len(result["reason_codes"])
        assert all(isinstance(s, str) and len(s) > 0 for s in result["reason_bn"])


def test_float_endpoint():
    payload = {
        "business_id": BID,
        "hourly_history": [
            {"date": "2026-10-01", "hour": h, "net_cash_demand_minor": 50000 + h * 1000, "efloat_demand_minor": 80000}
            for h in range(24)
        ] * 7,  # 7 days of hourly history
    }
    r = client.post("/v1/forecast/float", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["business_id"] == BID
    assert "hours" in body
