"""Tests for AI-01 forecast endpoint (updated for P6 models.py delegation)."""
from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def _hist(n: int, base: int = 100_000, step: int = 0) -> list[dict]:
    return [
        {"day": str(date(2026, 1, 1) + timedelta(days=i)), "sales_minor": base + i * step}
        for i in range(n)
    ]


def test_health():
    r = client.get("/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.7.0"


def test_models_endpoint():
    r = client.get("/v1/models")
    assert r.status_code == 200
    body = r.json()
    assert "sales7d" in body or "float24h" in body  # at least one capability


def test_forecast_abstains_on_cold_start():
    r = client.post("/v1/forecast/sales", json={"business_id": "b1", "history": _hist(10)})
    assert r.status_code == 200
    body = r.json()
    assert body["abstained"] is True
    assert body["days"] == []


def test_forecast_returns_seven_days_with_bands():
    r = client.post(
        "/v1/forecast/sales",
        json={"business_id": "b1", "history": _hist(60, base=100_000, step=500), "category": "grocery"},
    )
    body = r.json()
    assert body["abstained"] is False
    assert len(body["days"]) == 7
    assert body["confidence"] in ("high", "medium", "low")
    for d in body["days"]:
        assert d["p10_minor"] <= d["p50_minor"] <= d["p90_minor"]


def test_forecast_non_negative_values():
    r = client.post("/v1/forecast/sales", json={"business_id": "b2", "history": _hist(30)})
    body = r.json()
    if not body["abstained"]:
        for d in body["days"]:
            assert d["p10_minor"] >= 0
            assert d["p50_minor"] >= 0
            assert d["p90_minor"] >= 0


def test_forecast_with_cutoff():
    hist = _hist(60)
    cutoff = hist[45]["day"]
    r = client.post(
        "/v1/forecast/sales",
        json={"business_id": "b3", "history": hist[:46], "cutoff": cutoff},
    )
    body = r.json()
    if not body["abstained"]:
        # All forecast days should be after the cutoff
        from datetime import date as _date
        cutoff_dt = _date.fromisoformat(cutoff)
        for d in body["days"]:
            assert _date.fromisoformat(d["day"]) > cutoff_dt


def test_forecast_model_version_present():
    r = client.post("/v1/forecast/sales", json={"business_id": "b4", "history": _hist(60)})
    body = r.json()
    assert body["model_version"]
    assert isinstance(body["model_version"], str)
