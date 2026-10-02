"""Facts builder for BizFlow Language AI (AI-05 … AI-11).

Fetches deterministic facts from Supabase SQL views and assembles
the facts dict used by the LLM gateway. The LLM only gets the facts
dict — it never touches raw ledger tables.

All views are in supabase/migrations/0009_llm_facts_views.sql.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# Supabase service-role key — Edge Functions / DB jobs only
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.environ.get("SUPABASE_SERVICE_KEY", "")


def _supabase_rpc(function_name: str, params: dict) -> dict:
    """Call a Supabase RPC and return the JSON result."""
    import httpx  # type: ignore[import-untyped]

    url = f"{SUPABASE_URL}/rest/v1/rpc/{function_name}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    resp = httpx.post(url, json=params, headers=headers, timeout=5.0)
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, dict) else {}


def _supabase_select(view: str, params: dict) -> dict:
    """Fetch a single row from a Supabase view via its RPC wrapper."""
    try:
        return _supabase_rpc(f"llm_facts_{view}", params)
    except Exception as exc:
        logger.warning("Facts builder failed for view %s: %s", view, exc)
        return {}


# ---------------------------------------------------------------------------
# Individual facts builders (one per view group)
# ---------------------------------------------------------------------------

def build_daily_summary_facts(business_id: str) -> dict:
    """AI-05, AI-10: yesterday's sales, digital share, unmatched count."""
    return _supabase_select("daily_summary", {"p_business_id": business_id})


def build_forecast_facts(business_id: str) -> dict:
    """AI-05, AI-06: current 7-day forecast band + confidence."""
    return _supabase_select("forecast", {"p_business_id": business_id})


def build_obligations_facts(business_id: str) -> dict:
    """AI-05, AI-06: upcoming supplier dues, safe-to-withdraw."""
    return _supabase_select("obligations", {"p_business_id": business_id})


def build_float_facts(business_id: str) -> dict:
    """AI-02, AI-06 (agent): float position."""
    return _supabase_select("float", {"p_business_id": business_id})


def build_kpi_facts(business_id: str) -> dict:
    """AI-10: KPI values, red/yellow statuses."""
    return _supabase_select("kpis", {"p_business_id": business_id})


def build_briefing_facts(business_id: str) -> dict:
    """Combines facts needed for AI-05 daily briefing."""
    daily = build_daily_summary_facts(business_id)
    forecast = build_forecast_facts(business_id)
    obligations = build_obligations_facts(business_id)
    return {
        **daily,
        **forecast,
        **obligations,
        "_sources": ["daily_summary", "forecast", "obligations"],
    }


def build_assistant_facts(business_id: str, tool_name: str, params: dict) -> dict:
    """Build facts for a specific assistant tool call.

    Each tool fetches only what it needs — minimal data exposure to LLM.
    """
    mapping = {
        "get_sales_summary": lambda: _supabase_rpc("assistant_sales_summary", {
            "p_business_id": business_id, **params
        }),
        "list_transactions": lambda: _supabase_rpc("assistant_transactions", {
            "p_business_id": business_id, **params
        }),
        "get_review_queue": lambda: _supabase_rpc("assistant_review_queue", {
            "p_business_id": business_id
        }),
        "get_payables": lambda: _supabase_rpc("assistant_payables", {
            "p_business_id": business_id, **params
        }),
        "get_baki_summary": lambda: _supabase_rpc("assistant_baki_summary", {
            "p_business_id": business_id
        }),
        "get_forecast": lambda: build_forecast_facts(business_id),
        "get_safe_to_withdraw": lambda: _supabase_rpc("get_safe_to_withdraw_json", {
            "p_business_id": business_id
        }),
        "get_kpis": lambda: build_kpi_facts(business_id),
        "get_float": lambda: build_float_facts(business_id),
    }
    builder = mapping.get(tool_name)
    if builder is None:
        return {}
    try:
        result = builder()
        return result if isinstance(result, dict) else {"rows": result}
    except Exception as exc:
        logger.warning("Assistant tool %s failed: %s", tool_name, exc)
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# Stub builders for when Supabase is unavailable (testing / local dev)
# ---------------------------------------------------------------------------

def build_briefing_facts_stub(business_name: str = "Karim Store") -> dict:
    """Deterministic stub used in tests and local dev when Supabase is down."""
    return {
        "business_name": business_name,
        "yesterday_sales_minor": 184000,      # Tk 1,840
        "digital_share_pct": 39,
        "txn_count_yesterday": 22,
        "unmatched_count": 2,
        "forecast_week_p10_minor": 960000,    # Tk 9,600
        "forecast_week_p90_minor": 1120000,   # Tk 11,200
        "forecast_confidence": "medium",
        "next_due_supplier": "রহমান ট্রেডার্স",
        "next_due_amount_minor": 150000,      # Tk 1,500
        "next_due_date": "2026-10-04",
        "safe_to_withdraw_minor": 60000,      # Tk 600
        "model_version": "v0.7.0-stub",
        "_stub": True,
    }


def build_kpi_facts_stub() -> dict:
    """Stub KPI facts for tests."""
    return {
        "revenue_7d_minor": 1280000,
        "expense_7d_minor": 480000,
        "baki_outstanding_minor": 95000,
        "cash_on_hand_minor": 320000,
        "supplier_pressure_7d_minor": 450000,
        "forecast_available_minor": 520000,
        "kpi_statuses": {
            "supplier_pressure": "red",
            "baki_recovery": "yellow",
        },
        "_stub": True,
    }
