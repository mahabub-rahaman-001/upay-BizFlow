"""Bangla number normalizer — converts Bangla word forms and digits to integer poisha.

Handles:
  - Bangla digit characters ০১২৩৪৫৬৭৮৯
  - Bangla word forms: শত, হাজার, লাখ, কোটি
  - Mixed forms: "পাঁচশো পঞ্চাশ", "আড়াই হাজার", "দুই লাখ পঞ্চাশ হাজার"
  - English digits mixed with Bangla words: "500 টাকা"
  - Half forms: আড়াই (2.5x), দেড় (1.5x)

Output: always integer (poisha = taka × 100). Caller decides unit.
"""
from __future__ import annotations

import re
from typing import Optional


# ---------------------------------------------------------------------------
# Bangla digit → ASCII digit mapping
# ---------------------------------------------------------------------------
_BN_DIGIT_MAP = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


def bn_digits_to_ascii(text: str) -> str:
    """Replace Bangla Unicode digits with ASCII digits."""
    return text.translate(_BN_DIGIT_MAP)


# ---------------------------------------------------------------------------
# Number word tables
# ---------------------------------------------------------------------------

_ONES = {
    "শূন্য": 0, "এক": 1, "দুই": 2, "তিন": 3, "চার": 4, "পাঁচ": 5,
    "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "দশ": 10,
    "এগারো": 11, "বারো": 12, "তেরো": 13, "চোদ্দ": 14, "পনেরো": 15,
    "ষোলো": 16, "সতেরো": 17, "আঠারো": 18, "উনিশ": 19, "বিশ": 20,
    "একুশ": 21, "বাইশ": 22, "তেইশ": 23, "চব্বিশ": 24, "পঁচিশ": 25,
    "ছাব্বিশ": 26, "সাতাশ": 27, "আঠাশ": 28, "ঊনত্রিশ": 29, "ত্রিশ": 30,
    "একত্রিশ": 31, "বত্রিশ": 32, "তেত্রিশ": 33, "চৌত্রিশ": 34, "পঁয়ত্রিশ": 35,
    "ছত্রিশ": 36, "সাতত্রিশ": 37, "আটত্রিশ": 38, "ঊনচল্লিশ": 39, "চল্লিশ": 40,
    "একচল্লিশ": 41, "বিয়াল্লিশ": 42, "তেতাল্লিশ": 43, "চৌচল্লিশ": 44, "পঁয়তাল্লিশ": 45,
    "ছেচল্লিশ": 46, "সাতচল্লিশ": 47, "আটচল্লিশ": 48, "ঊনপঞ্চাশ": 49, "পঞ্চাশ": 50,
    "একান্ন": 51, "বায়ান্ন": 52, "তেপান্ন": 53, "চুয়ান্ন": 54, "পঞ্চান্ন": 55,
    "ছাপান্ন": 56, "সাতান্ন": 57, "আটান্ন": 58, "ঊনষাট": 59, "ষাট": 60,
    "একষট্টি": 61, "বাষট্টি": 62, "তেষট্টি": 63, "চৌষট্টি": 64, "পঁয়ষট্টি": 65,
    "ছেষট্টি": 66, "সাতষট্টি": 67, "আটষট্টি": 68, "ঊনসত্তর": 69, "সত্তর": 70,
    "একাত্তর": 71, "বাহাত্তর": 72, "তেহাত্তর": 73, "চুয়াত্তর": 74, "পঁচাত্তর": 75,
    "ছিয়াত্তর": 76, "সাতাত্তর": 77, "আটাত্তর": 78, "ঊনআশি": 79, "আশি": 80,
    "একাশি": 81, "বিরাশি": 82, "তিরাশি": 83, "চুরাশি": 84, "পঁচাশি": 85,
    "ছিয়াশি": 86, "সাতাশি": 87, "আটাশি": 88, "ঊননব্বই": 89, "নব্বই": 90,
    "একানব্বই": 91, "বিরানব্বই": 92, "তিরানব্বই": 93, "চুরানব্বই": 94, "পঁচানব্বই": 95,
    "ছিয়ানব্বই": 96, "সাতানব্বই": 97, "আটানব্বই": 98, "নিরানব্বই": 99,
}

_HUNDREDS = {
    "একশ": 100, "একশো": 100, "একশত": 100,
    "দুশ": 200, "দুশো": 200, "দুইশো": 200, "দুইশত": 200,
    "তিনশ": 300, "তিনশো": 300, "তিনশত": 300,
    "চারশ": 400, "চারশো": 400, "চারশত": 400,
    "পাঁচশ": 500, "পাঁচশো": 500, "পাঁচশত": 500,
    "ছয়শ": 600, "ছয়শো": 600, "ছয়শত": 600,
    "সাতশ": 700, "সাতশো": 700, "সাতশত": 700,
    "আটশ": 800, "আটশো": 800, "আটশত": 800,
    "নয়শ": 900, "নয়শো": 900, "নয়শত": 900,
}

_MULTIPLIERS = {
    "হাজার": 1_000,
    "লাখ": 100_000, "লক্ষ": 100_000,
    "কোটি": 10_000_000,
}

# Half forms
_HALF_WORDS = {
    "দেড়": 1.5,     # 1.5
    "আড়াই": 2.5,    # 2.5
    "সাড়ে": None,   # "সাড়ে তিন" = 3.5, handled separately
}


def _parse_word_number(text: str) -> Optional[float]:
    """Parse a Bangla number phrase (no digits) and return float value.
    Returns None if not parseable.
    """
    text = text.strip().lower()

    # Direct lookup ones
    if text in _ONES:
        return float(_ONES[text])
    if text in _HUNDREDS:
        return float(_HUNDREDS[text])

    # Half-word special cases
    if text == "দেড়":
        return 1.5
    if text == "আড়াই":
        return 2.5

    # "সাড়ে X" -> X + 0.5
    sare_m = re.match(r"সাড়ে\s+(.+)", text)
    if sare_m:
        inner = _parse_word_number(sare_m.group(1))
        if inner is not None:
            return inner + 0.5

    # Multiplier: e.g. "দুই হাজার পাঁচশো"
    total = 0.0
    remaining = text
    found_multiplier = False
    for mul_word, mul_val in sorted(_MULTIPLIERS.items(), key=lambda x: -x[1]):
        if mul_word in remaining:
            found_multiplier = True
            parts = remaining.split(mul_word, 1)
            prefix = parts[0].strip()
            remaining = parts[1].strip()
            prefix_val: float = 1.0
            if prefix:
                pv = _parse_word_number(prefix)
                prefix_val = pv if pv is not None else 1.0
            total += prefix_val * mul_val

    # After all multipliers, parse remaining hundreds + ones
    if found_multiplier:
        if remaining:
            # Try hundreds first
            for hw, hv in sorted(_HUNDREDS.items(), key=lambda x: -len(x[0])):
                if remaining.startswith(hw):
                    total += hv
                    remaining = remaining[len(hw):].strip()
                    break
            # Then ones
            if remaining:
                ov = _ONES.get(remaining)
                if ov is not None:
                    total += ov
        return total

    # No multiplier found — try hundreds + ones
    for hw, hv in sorted(_HUNDREDS.items(), key=lambda x: -len(x[0])):
        if remaining.startswith(hw):
            total += hv
            remaining = remaining[len(hw):].strip()
            break
    if remaining:
        ov = _ONES.get(remaining)
        if ov is not None:
            total += ov

    return total if total > 0 else None


def normalize_bangla_number(text: str) -> Optional[int]:
    """Parse Bangla/mixed number expression and return amount in POISHA.

    Examples:
      "পাঁচশো" -> 50000  (Tk 500 x 100)
      "দুই হাজার" -> 200000
      "আড়াই হাজার" -> 250000
      "5 হাজার" -> 500000
      "২ লাখ" -> 20000000
      "৫০০" -> 50000
      "500" -> 50000
      "পাঁচ হাজার দুইশো" -> 520000

    Returns None if the expression cannot be parsed.
    """
    if not text:
        return None

    # Strip currency suffixes
    clean = re.sub(r"\s*(টাকা|taka|tk\.?|৳)\s*", " ", text, flags=re.IGNORECASE).strip()
    # Convert Bangla digits -> ASCII
    clean = bn_digits_to_ascii(clean)

    # -----------------------------------------------------------------
    # 1. Pure numeric (possibly with comma separators and no words)
    # -----------------------------------------------------------------
    numeric_only = re.sub(r"[,\s]", "", clean)
    if re.fullmatch(r"\d+(\.\d+)?", numeric_only):
        taka = float(numeric_only)
        return int(round(taka * 100))

    # -----------------------------------------------------------------
    # 2. Mixed: digits + multiplier word (e.g. "5 হাজার", "2.5 লাখ", "১০ হাজার")
    # -----------------------------------------------------------------
    m = re.match(r"^(\d+(?:\.\d+)?)\s+(.+)$", clean)
    if m:
        num_part = float(m.group(1))
        word_part = m.group(2).strip()
        mul = _MULTIPLIERS.get(word_part)
        if mul:
            return int(round(num_part * mul * 100))
        # Word part might be a multiplier with extra (e.g. "হাজার পাঁচশো" -- unusual, skip)

    # -----------------------------------------------------------------
    # 3. Pure word-based parsing
    # -----------------------------------------------------------------
    val = _parse_word_number(clean)
    if val is not None:
        return int(round(val * 100))

    return None


def parse_entry_text(utterance: str) -> dict:
    """Extract {amount_minor, raw_number_text} from an utterance.

    Used by AI-07 parse pipeline before rule/LLM classification.
    Returns {} if no number found.

    Priority:
    1. Digit runs (৫০০, 1500) with optional multiplier suffix
    2. Multiplier-word phrases mid-utterance ("দুই হাজার টাকার মাল")
    3. Individual hundreds/ones words (পাঁচশো, দুশো)
    """
    # 1. Digit runs with optional multiplier suffix
    digit_run = re.search(
        r"[০-৯\d][০-৯\d,. ]*(?:\s*(?:হাজার|লাখ|লক্ষ|কোটি))?", utterance
    )
    if digit_run:
        candidate = digit_run.group(0).strip()
        amount = normalize_bangla_number(candidate)
        if amount is not None:
            return {"amount_minor": amount, "raw_number_text": candidate}

    # 2. Multiplier-word scan: find the first multiplier and extract phrase before it
    for mul_word in ["কোটি", "লাখ", "লক্ষ", "হাজার"]:
        if mul_word in utterance:
            idx = utterance.index(mul_word)
            # Take up to 40 chars before the multiplier + the multiplier itself
            prefix_text = utterance[max(0, idx - 40): idx + len(mul_word)]
            amount = normalize_bangla_number(prefix_text.strip())
            if amount is not None:
                return {"amount_minor": amount, "raw_number_text": prefix_text.strip()}

    # 3. Individual word lookup (পাঁচশো, দুশো, etc.)
    for word, val in {**_HUNDREDS, **_ONES}.items():
        if word in utterance and isinstance(val, int) and val > 0:
            amount = normalize_bangla_number(word)
            if amount is not None:
                return {"amount_minor": amount, "raw_number_text": word}

    return {}

