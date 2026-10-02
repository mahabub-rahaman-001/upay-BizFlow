"""AI-11 report intent mapping.

This endpoint returns only an enum-constrained report key and date filters. It never
generates report rows or financial numbers; the client obtains those from report_rows().
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from pydantic import BaseModel

from ..llm.gateway import llm_json_complete

router = APIRouter()

REPORT_KEYS = [
    "daily_closing",
    "sales_by_day",
    "sales_by_category",
    "cash_vs_digital",
    "expenses",
    "supplier_dues",
    "supplier_payments",
    "baki",
    "refunds_disputes",
    "offers",
    "agent_book",
    "commission",
    "kpi_summary",
]

REPORT_META = {
    "sales_by_day": {"name_bn": "দিন অনুযায়ী বিক্রি"},
    "sales_by_category": {"name_bn": "বিভাগ অনুযায়ী বিক্রি"},
    "cash_vs_digital": {"name_bn": "নগদ বনাম ডিজিটাল"},
    "expenses": {"name_bn": "খরচ"},
    "baki": {"name_bn": "বাকি"},
    "agent_book": {"name_bn": "এজেন্ট লেজার"},
    "commission": {"name_bn": "কমিশন"},
}

REPORT_BUILDER_SYSTEM_PROMPT = f"""তুমি একটি report intent mapper।
শুধু এই JSON দেবে:
{{"report_key": "<one of {REPORT_KEYS}>", "from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD"}}
কোনো রিপোর্টের সারি, পরিমাণ, মোট, preview বা download URL তৈরি করবে না।
তারিখ না থাকলে from_date আজ থেকে ৭ দিন আগে এবং to_date আজ।"""


class ReportBuilderRequest(BaseModel):
    request_text: str


def _valid_date(value: object, fallback: date) -> date:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return fallback


def _fallback_key(request_text: str) -> str:
    text = request_text.casefold()
    matches = (
        (("খরচ", "expense"), "expenses"),
        (("বাকি", "credit"), "baki"),
        (("নগদ", "digital", "cash"), "cash_vs_digital"),
        (("কমিশন", "commission"), "commission"),
        (("এজেন্ট", "agent"), "agent_book"),
        (("category", "বিভাগ"), "sales_by_category"),
    )
    for needles, key in matches:
        if any(needle in text for needle in needles):
            return key
    return "sales_by_day"


@router.post("/ai/report-builder")
def report_builder(req: ReportBuilderRequest):
    """Map natural language to a safe report key and dates, never to report data."""
    today = datetime.now(ZoneInfo("Asia/Dhaka")).date()
    default_from = today - timedelta(days=7)
    result = llm_json_complete(
        system_prompt=REPORT_BUILDER_SYSTEM_PROMPT,
        user_content=f"অনুরোধ: {req.request_text}",
        max_tokens=120,
    )

    report_key = result.get("report_key")
    if report_key not in REPORT_KEYS:
        report_key = _fallback_key(req.request_text)

    from_date = _valid_date(result.get("from_date"), default_from)
    to_date = _valid_date(result.get("to_date"), today)
    if from_date > to_date or (to_date - from_date).days > 366:
        from_date, to_date = default_from, today

    return {
        "report_key": report_key,
        "filters": {"from_date": from_date.isoformat(), "to_date": to_date.isoformat()},
    }
