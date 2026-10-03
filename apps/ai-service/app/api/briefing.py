"""AI-05 — Daily Briefing endpoint (GET /v1/ai/briefing).

Architecture (docs/08 §11.1):
  facts builder → LLM (placeholders) → validator → fill → Bangla text + citations

Cached per business per calendar day (stale after next closing).
"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from ..llm.facts import build_briefing_facts, build_briefing_facts_stub
from ..llm.gateway import llm_complete

router = APIRouter()
logger = logging.getLogger(__name__)

# Simple in-process cache {cache_key: {text, facts_hash, cached_at}}
_briefing_cache: dict[str, dict] = {}

_USE_STUB = os.environ.get("LLM_USE_STUB", "false").lower() == "true"


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

BRIEFING_SYSTEM_PROMPT = """তুমি BizFlow-এর একজন বিশ্বস্ত ব্যবসায়িক সহকারী।
তোমার কাজ: নিচের facts JSON ব্যবহার করে একটি সংক্ষিপ্ত, বাংলা সকালের ব্রিফিং লেখা।

নিয়মাবলী (অবশ্যই মানতে হবে):
1. সমস্ত সংখ্যা **শুধুমাত্র** {{placeholder}} ফর্ম্যাটে লিখবে — কোনো আসল সংখ্যা লিখবে না।
   যেমন: "গতকাল {{yesterday_sales_display}} বিক্রি হয়েছে।" — ঠিক আছে।
         "গতকাল Tk 1,840 বিক্রি হয়েছে।" — ভুল।
2. সর্বোচ্চ ৪টি বাক্য লিখবে।
3. সহজ ও বন্ধুত্বপূর্ণ ভাষা ব্যবহার করবে।
4. শুধু facts JSON-এ থাকা তথ্য উল্লেখ করবে।

Placeholder কী:
- {{yesterday_sales_display}} — গতকালের মোট বিক্রি
- {{digital_share_pct}} — ডিজিটাল শতাংশ
- {{unmatched_count}} — মেলানো বাকি পেমেন্ট সংখ্যা
- {{next_due_supplier}} — পরবর্তী সরবরাহকারীর নাম
- {{next_due_amount_display}} — তাদের বকেয়া পরিমাণ
- {{next_due_date_display}} — বকেয়ার তারিখ
- {{forecast_week_p10_display}} — সাপ্তাহিক পূর্বাভাস (কম)
- {{forecast_week_p90_display}} — সাপ্তাহিক পূর্বাভাস (বেশি)
- {{safe_to_withdraw_display}} — আজ নিরাপদ উত্তোলনের পরিমাণ
"""


def _build_placeholder_values(facts: dict) -> dict[str, str]:
    """Convert facts (minor amounts) to display strings for placeholder filling."""
    def fmt(minor: int) -> str:
        taka = minor // 100
        return f"Tk {taka:,}"

    return {
        "yesterday_sales_display": fmt(facts.get("yesterday_sales_minor", 0)),
        "digital_share_pct": str(facts.get("digital_share_pct", 0)),
        "unmatched_count": str(facts.get("unmatched_count", 0)),
        "next_due_supplier": facts.get("next_due_supplier", "—"),
        "next_due_amount_display": fmt(facts.get("next_due_amount_minor", 0)),
        "next_due_date_display": facts.get("next_due_date", "—"),
        "forecast_week_p10_display": fmt(facts.get("forecast_week_p10_minor", 0)),
        "forecast_week_p90_display": fmt(facts.get("forecast_week_p90_minor", 0)),
        "safe_to_withdraw_display": fmt(facts.get("safe_to_withdraw_minor", 0)),
        "txn_count_yesterday": str(facts.get("txn_count_yesterday", 0)),
    }


def _fill_placeholders(text: str, values: dict[str, str]) -> str:
    """Replace {{key}} placeholders server-side (never by LLM)."""
    for key, val in values.items():
        text = text.replace(f"{{{{{key}}}}}", val)
    return text


def _deterministic_fallback(facts: dict) -> str:
    """Serve a deterministic briefing when LLM fails — always safe."""
    vals = _build_placeholder_values(facts)
    return (
        f"শুভ সকাল! গতকাল মোট বিক্রি হয়েছে {vals['yesterday_sales_display']} "
        f"({vals['digital_share_pct']}% ডিজিটাল)। "
        f"{vals['unmatched_count']}টি পেমেন্ট মেলানো বাকি। "
        f"{vals['next_due_supplier']}-কে {vals['next_due_date_display']} তারিখে "
        f"{vals['next_due_amount_display']} দিতে হবে।"
    )


def _cache_key(business_id: str) -> str:
    return f"{business_id}:{date.today().isoformat()}"


@router.get("/ai/briefing")
def get_briefing(
    business_id: str = Query(..., description="Business UUID"),
    x_service_token: Optional[str] = Header(None, alias="X-Service-Token"),
    force_refresh: bool = Query(False),
):
    """Return today's AI briefing for a business.

    Facts are fetched from deterministic SQL views.
    LLM writes wording using {{placeholders}} only.
    Numbers are injected server-side after validation.
    """
    cache_key = _cache_key(business_id)

    # Serve from cache unless forced
    if not force_refresh and cache_key in _briefing_cache:
        cached = _briefing_cache[cache_key]
        return {**cached, "from_cache": True}

    # 1. Fetch facts
    if _USE_STUB:
        facts = build_briefing_facts_stub()
    else:
        try:
            facts = build_briefing_facts(business_id)
        except Exception as exc:
            logger.error("Facts builder failed: %s", exc)
            facts = build_briefing_facts_stub()

    if not facts:
        raise HTTPException(status_code=503, detail="Facts unavailable")

    # 2. Compute facts hash (for audit)
    facts_hash = hashlib.sha256(str(sorted(facts.items())).encode()).hexdigest()[:16]

    # 3. Build placeholder values (all Tk formatting done here, not by LLM)
    placeholder_values = _build_placeholder_values(facts)

    # 4. Build user content (facts as JSON — LLM only sees placeholder keys, not amounts)
    user_content = (
        f"Business: {facts.get('business_name', 'আপনার ব্যবসা')}\n"
        f"Available placeholders: {list(placeholder_values.keys())}\n\n"
        "এই placeholders ব্যবহার করে ৩–৪ বাক্যের বাংলা ব্রিফিং লেখো।"
    )

    # 5. LLM call with number validator
    result = llm_complete(
        system_prompt=BRIEFING_SYSTEM_PROMPT,
        user_content=user_content,
        facts=facts,          # validator checks against this
        business_id=business_id,
        validate_numbers=True,
        fallback_text="__use_deterministic__",
    )

    raw_text = result["text"]
    if result["from_fallback"] or raw_text == "__use_deterministic__":
        briefing_text = _deterministic_fallback(facts)
        from_fallback = True
    else:
        # 6. Fill placeholders server-side
        briefing_text = _fill_placeholders(raw_text, placeholder_values)
        from_fallback = False

    response = {
        "briefing_bn": briefing_text,
        "facts_hash": facts_hash,
        "prompt_version": "briefing-v1.0",
        "model_version": "gpt-4o-mini",
        "from_fallback": from_fallback,
        "from_cache": False,
        "latency_ms": result["latency_ms"],
        "citations": [
            {"source": s, "period": "yesterday + 7-day forecast"}
            for s in facts.get("_sources", ["daily_summary", "forecast", "obligations"])
        ],
    }

    # Cache result
    _briefing_cache[cache_key] = response
    return response
