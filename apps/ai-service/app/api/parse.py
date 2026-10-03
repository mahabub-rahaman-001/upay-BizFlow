"""AI-07 — Voice/text parse + Bangla number normalizer (POST /v1/ai/parse).

Pipeline (docs/08 §11.5):
  text/audio → STT (if audio) → Bangla number normalizer → rule parser →
  LLM fallback (enum-constrained, no hallucination) → draft (never auto-saves)

AI-08 — Expense auto-categorizer (POST /v1/ai/categorize).
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from ..llm.gateway import llm_json_complete
from ..llm.number_normalizer import normalize_bangla_number, parse_entry_text

router = APIRouter()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Entry kinds (enum — LLM constrained to these)
# ---------------------------------------------------------------------------

ENTRY_KINDS = ["CASH_SALE", "EXPENSE", "BAKI_GAVE", "BAKI_RECEIVED", "FLOAT_IN", "FLOAT_OUT", "UNKNOWN"]

# ---------------------------------------------------------------------------
# Expense categories (enum — LLM constrained to these)
# ---------------------------------------------------------------------------

EXPENSE_CATEGORIES = [
    "grocery_stock", "rent", "utilities", "staff_wages",
    "transport", "marketing", "equipment", "miscellaneous",
]

EXPENSE_CATEGORIES_BN = {
    "grocery_stock": "মালামাল/স্টক",
    "rent": "ভাড়া",
    "utilities": "বিদ্যুৎ/পানি/গ্যাস",
    "staff_wages": "বেতন",
    "transport": "পরিবহন",
    "marketing": "বিজ্ঞাপন/অফার",
    "equipment": "যন্ত্রপাতি/সরঞ্জাম",
    "miscellaneous": "বিবিধ",
}

# Order matters — checked in insertion order. Most-specific first.
# BAKI_GAVE/RECEIVED and FLOAT must precede EXPENSE because "দিলাম"
# appears in EXPENSE keywords and would false-match baki entries.
_KIND_KEYWORDS: dict[str, list[str]] = {
    "BAKI_GAVE":     ["বাকি দিলাম", "বাকিতে দিলাম", "ধার দিলাম"],
    "BAKI_RECEIVED": ["বাকি পেলাম", "বাকি ফেরত", "ধার ফেরত"],
    "FLOAT_IN":      ["ক্যাশ ইন", "cash in", "নগদ জমা", "ফ্লোট ইন"],
    "FLOAT_OUT":     ["ক্যাশ আউট", "cash out", "নগদ উত্তোলন", "ফ্লোট আউট"],
    "CASH_SALE":     ["বিক্রি", "বিক্রয়", "sale", "বেচ", "দিলাম পণ্য"],
    "EXPENSE":       ["খরচ", "expense", "কিনলাম", "পরিশোধ", "ভাড়া", "বেতন"],
}



_EXPENSE_KEYWORDS: dict[str, list[str]] = {
    "grocery_stock": ["মাল", "পণ্য", "স্টক", "বাজার", "সাপ্লাই"],
    "rent": ["ভাড়া", "দোকান ভাড়া", "rent"],
    "utilities": ["বিদ্যুৎ", "পানি", "গ্যাস", "বিল", "electricity"],
    "staff_wages": ["বেতন", "মাইনে", "salary", "wages"],
    "transport": ["পরিবহন", "গাড়ি", "রিকশা", "transport"],
    "marketing": ["বিজ্ঞাপন", "অফার", "marketing", "promo"],
    "equipment": ["যন্ত্রপাতি", "মেশিন", "সরঞ্জাম", "equipment"],
}


def _rule_classify_kind(text: str) -> tuple[str, float]:
    """Return (kind, confidence) from keyword rules."""
    text_lower = text.lower()
    for kind, keywords in _KIND_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return kind, 0.85
    return "UNKNOWN", 0.0


def _rule_classify_expense(text: str) -> tuple[str, float]:
    """Return (category, confidence) from keyword rules."""
    text_lower = text.lower()
    for cat, keywords in _EXPENSE_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return cat, 0.80
    return "miscellaneous", 0.4


# ---------------------------------------------------------------------------
# AI-07: Parse endpoint
# ---------------------------------------------------------------------------

class ParseRequest(BaseModel):
    text: Optional[str] = None
    audio_path: Optional[str] = None  # STT placeholder
    business_id: str = ""


class ParseResponse(BaseModel):
    kind: str
    amount_minor: Optional[int] = None
    category: Optional[str] = None
    category_bn: Optional[str] = None
    confidence: float
    raw_number_text: Optional[str] = None
    draft: bool = True          # Always True — never auto-saves
    note: Optional[str] = None
    parse_method: str           # "rule" | "llm" | "failed"


@router.post("/ai/parse", response_model=ParseResponse)
def parse_entry(req: ParseRequest):
    """Parse a Bangla voice/text entry into a structured draft.

    Always returns a DRAFT — the mobile UI must show it for confirmation.
    Never auto-posts to the ledger.
    """
    text = req.text or ""

    # 1. STT stub (audio_path handling would invoke Bangla STT in production)
    if req.audio_path and not text:
        text = f"[audio: {req.audio_path}]"  # Stub
        logger.info("STT would be called for %s; stub used.", req.audio_path)

    if not text.strip():
        return ParseResponse(
            kind="UNKNOWN", confidence=0.0, parse_method="failed",
            draft=True, note="কোনো লেখা পাওয়া যায়নি"
        )

    # 2. Bangla number normalizer
    num_info = parse_entry_text(text)
    amount_minor = num_info.get("amount_minor")
    raw_number_text = num_info.get("raw_number_text")

    # 3. Rule-based kind classification
    kind, kind_conf = _rule_classify_kind(text)

    # 4. If rule confidence low → LLM fallback with enum-constrained JSON schema
    if kind_conf < 0.8 or kind == "UNKNOWN":
        llm_result = llm_json_complete(
            system_prompt=(
                f"Extract the entry type from this Bangla/English text. "
                f"Respond ONLY with JSON: {{\"kind\": \"<one of {ENTRY_KINDS}>\", "
                f"\"confidence\": 0.0-1.0, \"category\": \"<expense category if EXPENSE, else null>\"}}. "
                f"Do not include any other keys or text."
            ),
            user_content=f"Text: {text}",
            business_id=req.business_id,
        )
        if llm_result and llm_result.get("kind") in ENTRY_KINDS:
            kind = llm_result["kind"]
            kind_conf = float(llm_result.get("confidence", 0.7))
            if kind == "EXPENSE" and llm_result.get("category"):
                cat = llm_result["category"]
                return ParseResponse(
                    kind=kind,
                    amount_minor=amount_minor,
                    raw_number_text=raw_number_text,
                    category=cat,
                    category_bn=EXPENSE_CATEGORIES_BN.get(cat, cat),
                    confidence=kind_conf,
                    draft=True,
                    parse_method="llm",
                )
            return ParseResponse(
                kind=kind,
                amount_minor=amount_minor,
                raw_number_text=raw_number_text,
                confidence=kind_conf,
                draft=True,
                parse_method="llm",
            )
        # LLM also failed
        return ParseResponse(
            kind="UNKNOWN",
            amount_minor=amount_minor,
            raw_number_text=raw_number_text,
            confidence=0.3,
            draft=True,
            parse_method="failed",
            note="স্বয়ংক্রিয়ভাবে বুঝতে পারিনি — অনুগ্রহ করে নিজে পূরণ করুন",
        )

    # 5. Rule classifier succeeded
    category: Optional[str] = None
    category_bn: Optional[str] = None
    if kind == "EXPENSE":
        category, _ = _rule_classify_expense(text)
        category_bn = EXPENSE_CATEGORIES_BN.get(category, category)

    return ParseResponse(
        kind=kind,
        amount_minor=amount_minor,
        raw_number_text=raw_number_text,
        category=category,
        category_bn=category_bn,
        confidence=kind_conf,
        draft=True,
        parse_method="rule",
    )


# ---------------------------------------------------------------------------
# AI-08: Expense auto-categorizer
# ---------------------------------------------------------------------------

class CategorizeRequest(BaseModel):
    note: str
    amount_minor: Optional[int] = None
    business_id: str = ""


class CategorizeResponse(BaseModel):
    category: str
    category_bn: str
    confidence: float
    method: str  # "rule" | "llm"


@router.post("/ai/categorize", response_model=CategorizeResponse)
def categorize_expense(req: CategorizeRequest):
    """Auto-categorize an expense by note text.

    Tries keyword rules first (fast, no LLM cost).
    Falls back to LLM with enum-constrained schema if below threshold.
    """
    category, confidence = _rule_classify_expense(req.note)

    if confidence >= 0.7:
        return CategorizeResponse(
            category=category,
            category_bn=EXPENSE_CATEGORIES_BN[category],
            confidence=confidence,
            method="rule",
        )

    # LLM fallback — enum-constrained, no hallucination possible
    llm_result = llm_json_complete(
        system_prompt=(
            f"Categorize this expense note into one of these exact categories: "
            f"{EXPENSE_CATEGORIES}. "
            f"Respond ONLY with JSON: {{\"category\": \"<category>\", \"confidence\": 0.0-1.0}}."
        ),
        user_content=f"Note: {req.note}\nAmount: {req.amount_minor}",
        business_id=req.business_id,
    )

    if llm_result and llm_result.get("category") in EXPENSE_CATEGORIES:
        cat = llm_result["category"]
        return CategorizeResponse(
            category=cat,
            category_bn=EXPENSE_CATEGORIES_BN[cat],
            confidence=float(llm_result.get("confidence", 0.65)),
            method="llm",
        )

    return CategorizeResponse(
        category="miscellaneous",
        category_bn=EXPENSE_CATEGORIES_BN["miscellaneous"],
        confidence=0.3,
        method="rule",
    )
