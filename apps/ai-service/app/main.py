"""BizFlow AI service (FastAPI) — P6 Predictive AI + P7 Language AI.

Called server-to-server only (Edge Functions / DB jobs), never directly by the app.

P6 Endpoints:
  GET  /v1/health             liveness
  GET  /v1/models             model version manifest
  POST /v1/forecast/sales     AI-01: 7-day sales forecast (LightGBM + baseline fallback)
  POST /v1/forecast/float     AI-02: 24h agent float demand forecast
  POST /v1/match/suggest      AI-03: smart reconciliation match scorer
  POST /v1/anomaly/score      AI-04: transaction anomaly flags

P7 Endpoints:
  GET  /v1/ai/briefing        AI-05: daily Bangla briefing (facts → LLM → validator)
  POST /v1/ai/assistant       AI-06: Bangla assistant with read-only tools + citations
  POST /v1/ai/parse           AI-07: voice/text parse with Bangla number normalizer
  POST /v1/ai/categorize      AI-08: expense auto-categorizer
  GET  /v1/ai/kpi-explain     AI-10: KPI explanations in Bangla
  POST /v1/ai/report-builder  AI-11: natural language → enum report key + filters

Auth: signed service JWT (aud=ai-service) verified by caller (Edge Function).
Network: allow-list only -- no direct end-user access.
"""
import json
from pathlib import Path

from fastapi import FastAPI

# P6 — Predictive AI
from .api.forecast import router as forecast_router
from .api.float import router as float_router
from .api.match import router as match_router
from .api.anomaly import router as anomaly_router

# P7 — Language AI
from .api.briefing import router as briefing_router
from .api.assistant import router as assistant_router
from .api.parse import router as parse_router
from .api.kpi_explain import router as kpi_explain_router
from .api.report_builder import router as report_builder_router

app = FastAPI(title="BizFlow AI Service", version="0.8.0")

# P6
app.include_router(forecast_router,      prefix="/v1")
app.include_router(float_router,         prefix="/v1")
app.include_router(match_router,         prefix="/v1")
app.include_router(anomaly_router,       prefix="/v1")

# P7
app.include_router(briefing_router,      prefix="/v1")
app.include_router(assistant_router,     prefix="/v1")
app.include_router(parse_router,         prefix="/v1")
app.include_router(kpi_explain_router,   prefix="/v1")
app.include_router(report_builder_router, prefix="/v1")

_MODEL_DIR = Path(__file__).parent.parent / "models"


@app.get("/v1/health")
def health() -> dict:
    return {"status": "ok", "service": "bizflow-ai", "version": "0.8.0", "capabilities": ["AI-01","AI-02","AI-03","AI-04","AI-05","AI-06","AI-07","AI-08","AI-10","AI-11"]}


@app.get("/v1/models")
def models() -> dict:
    manifest_path = _MODEL_DIR / "models.json"
    if manifest_path.exists():
        return json.loads(manifest_path.read_text())
    return {
        "sales7d":  {"active": "baseline-seasonal-0.1", "note": "run app.ml.train to fit LightGBM"},
        "float24h": {"active": "baseline-seasonal-0.1", "note": "run app.ml.train to fit LightGBM"},
    }
