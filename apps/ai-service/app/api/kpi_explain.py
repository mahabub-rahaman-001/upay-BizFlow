"""AI-10 — KPI Explanation (GET /v1/ai/kpi-explain).

KPIs are computed in SQL (docs/08 §11.7).
LLM writes ≤ 2 Bangla sentences per red/yellow KPI citing formula inputs.
Numbers are injected after validation — LLM uses placeholders.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, Query

from ..llm.facts import build_kpi_facts, build_kpi_facts_stub
from ..llm.gateway import llm_complete

router = APIRouter()
logger = logging.getLogger(__name__)

_USE_STUB = os.environ.get("LLM_USE_STUB", "false").lower() == "true"

# ---------------------------------------------------------------------------
# KPI definitions with Bengali descriptions
# ---------------------------------------------------------------------------

KPI_META = {
    "supplier_pressure": {
        "name_bn": "সরবরাহকারী চাপ",
        "formula_bn": "আগামী ৭ দিনের পাওনা ÷ অনুমানিত আয়",
        "red_hint": "পাওনা বেশি — কাশ ফ্লো ঝুঁকিতে",
        "ph": {
            "due": "{{supplier_pressure_7d_display}}",
            "available": "{{forecast_available_display}}",
        }
    },
    "baki_recovery": {
        "name_bn": "বাকি উদ্ধার",
        "formula_bn": "৩০ দিনে উদ্ধার ÷ মোট বকেয়া",
        "red_hint": "বাকি বেড়েই চলছে",
        "ph": {
            "outstanding": "{{baki_outstanding_display}}",
        }
    },
    "digital_share": {
        "name_bn": "ডিজিটাল অংশ",
        "formula_bn": "ডিজিটাল পেমেন্ট ÷ মোট বিক্রি × ১০০",
        "red_hint": "নগদ নির্ভরতা বেশি",
        "ph": {
            "pct": "{{digital_share_7d_pct}}",
        }
    },
}


def _ph_values_from_facts(facts: dict) -> dict[str, str]:
    def fmt(minor: int) -> str:
        return f"Tk {minor // 100:,}"
    return {
        "supplier_pressure_7d_display": fmt(facts.get("supplier_pressure_7d_minor", 0)),
        "forecast_available_display": fmt(facts.get("forecast_available_minor", 0)),
        "baki_outstanding_display": fmt(facts.get("baki_outstanding_minor", 0)),
        "digital_share_7d_pct": str(facts.get("digital_share_7d_pct", 0)),
        "revenue_7d_display": fmt(facts.get("revenue_7d_minor", 0)),
        "expense_7d_display": fmt(facts.get("expense_7d_minor", 0)),
    }


KPI_SYSTEM_PROMPT = """তুমি BizFlow-এর KPI ব্যাখ্যাকারী। 
প্রতিটি লাল বা হলুদ KPI-এর জন্য **সর্বোচ্চ ২টি বাক্য** বাংলায় লিখবে।
শুধু {{placeholder}} ফর্ম্যাটে সংখ্যা লিখবে — কোনো আসল সংখ্যা লিখবে না।
ফর্ম্যাট: {{"kpi_key": "ব্যাখ্যা"}}
"""


@router.get("/ai/kpi-explain")
def kpi_explain(
    business_id: str = Query(...),
):
    """Return Bangla explanations for red/yellow KPIs.

    Facts from SQL → LLM writes placeholder text → validator → fill.
    """
    # 1. Fetch KPI facts
    if _USE_STUB:
        facts = build_kpi_facts_stub()
    else:
        try:
            facts = build_kpi_facts(business_id)
        except Exception as exc:
            logger.warning("KPI facts failed: %s; using stub", exc)
            facts = build_kpi_facts_stub()

    ph_values = _ph_values_from_facts(facts)
    statuses: dict = facts.get("kpi_statuses", {})

    # 2. Only explain red/yellow KPIs
    red_yellow = {k: v for k, v in statuses.items() if v in ("red", "yellow")}

    if not red_yellow:
        return {
            "explanations": {},
            "message_bn": "সব KPI ভালো অবস্থানে আছে।",
            "from_fallback": False,
        }

    # 3. Build user content listing which KPIs need explanation
    kpi_descriptions = []
    for kpi_key, status in red_yellow.items():
        meta = KPI_META.get(kpi_key, {})
        kpi_descriptions.append(
            f"KPI: {kpi_key} | স্ট্যাটাস: {status} | নাম: {meta.get('name_bn', kpi_key)} | "
            f"সূত্র: {meta.get('formula_bn', '?')}"
        )

    user_content = (
        "নিচের KPI গুলোর ব্যাখ্যা দাও (placeholders ব্যবহার করে):\n\n"
        + "\n".join(kpi_descriptions)
        + f"\n\nউপলব্ধ placeholders: {list(ph_values.keys())}"
    )

    # 4. LLM call
    result = llm_complete(
        system_prompt=KPI_SYSTEM_PROMPT,
        user_content=user_content,
        facts=facts,
        business_id=business_id,
        validate_numbers=True,
        fallback_text="__fallback__",
    )

    if result["from_fallback"] or result["text"] == "__fallback__":
        # Deterministic fallback per KPI
        explanations = {}
        for kpi_key in red_yellow:
            meta = KPI_META.get(kpi_key, {})
            hint = meta.get("red_hint", "")
            explanations[kpi_key] = f"{meta.get('name_bn', kpi_key)}: {hint}।"
        return {"explanations": explanations, "from_fallback": True}

    # 5. Parse JSON from LLM (it returns {kpi_key: explanation_text})
    import json, re
    raw = result["text"].strip()
    try:
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        explanations_raw: dict = json.loads(cleaned)
    except Exception:
        explanations_raw = {kpi_key: raw for kpi_key in red_yellow}

    # 6. Fill placeholders server-side
    explanations = {}
    for kpi_key, text in explanations_raw.items():
        for ph_key, ph_val in ph_values.items():
            text = text.replace(f"{{{{{ph_key}}}}}", ph_val)
        explanations[kpi_key] = text

    return {
        "explanations": explanations,
        "from_fallback": False,
        "latency_ms": result["latency_ms"],
        "facts_hash": result.get("facts_hash"),
    }
