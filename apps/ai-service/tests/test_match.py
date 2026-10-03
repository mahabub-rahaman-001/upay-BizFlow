"""Tests for AI-03 match scorer."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

BASE_TXN = {
    "id": "txn-001",
    "amount_minor": 85000,
    "occurred_at": "2026-10-02T10:42:11+06:00",
    "reference": "INV-1048",
    "actor_user_id": "user-001",
    "payer_hash": "hash-abc",
}


def _req(candidates):
    return {"txn": BASE_TXN, "candidates": candidates}


def test_exact_match_is_auto():
    cand = {
        "id": "cand-001",
        "amount_minor": 85000,
        "occurred_at": "2026-10-02T10:42:15+06:00",
        "reference": "INV-1048",
    }
    r = client.post("/v1/match/suggest", json=_req([cand]))
    assert r.status_code == 200
    results = r.json()["results"]
    assert results[0]["label"] == "auto_match"
    assert results[0]["score"] == 1.0


def test_close_match_is_suggested():
    cand = {
        "id": "cand-002",
        "amount_minor": 85000,
        "occurred_at": "2026-10-02T10:45:00+06:00",
        "reference": "INV-1048x",   # slightly different
        "actor_user_id": "user-001",
    }
    r = client.post("/v1/match/suggest", json=_req([cand]))
    assert r.status_code == 200
    result = r.json()["results"][0]
    # Should be either "suggested" or "review" -- never auto_match
    assert result["label"] in ("suggested", "review")


def test_unrelated_is_review():
    cand = {
        "id": "cand-003",
        "amount_minor": 10000,
        "occurred_at": "2026-09-20T08:00:00+06:00",
        "reference": "XYZ-9999",
    }
    r = client.post("/v1/match/suggest", json=_req([cand]))
    assert r.status_code == 200
    result = r.json()["results"][0]
    assert result["label"] == "review"


def test_empty_candidates():
    r = client.post("/v1/match/suggest", json=_req([]))
    assert r.status_code == 200
    assert r.json()["results"] == []


def test_top_candidate_ranked_first():
    cands = [
        {"id": "c1", "amount_minor": 10000, "occurred_at": "2026-09-01T00:00:00+06:00", "reference": "OTHER"},
        {"id": "c2", "amount_minor": 85000, "occurred_at": "2026-10-02T10:42:11+06:00", "reference": "INV-1048"},
    ]
    r = client.post("/v1/match/suggest", json=_req(cands))
    results = r.json()["results"]
    assert results[0]["candidate_id"] == "c2"
    assert results[0]["score"] > results[1]["score"]
