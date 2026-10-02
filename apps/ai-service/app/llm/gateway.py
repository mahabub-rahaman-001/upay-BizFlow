"""LLM Gateway with Number Validator for BizFlow Language AI (P7).

Core rules (docs/08 §11):
- LLM never computes money. Facts JSON → LLM (wording + placeholders) → validator → fill.
- Every number in LLM output must trace back to the facts dict.
- On validation failure: retry up to max_retries with tighter constraints; then serve fallback.
- Per-business daily budget cap enforced.
- Prompt-injection defence: user text goes into delimited data fields, never as instructions.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config (from env – injected by Edge Function / Docker compose)
# ---------------------------------------------------------------------------

LLM_BASE_URL: str = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY: str = os.environ.get("LLM_API_KEY", "")
LLM_MODEL: str = os.environ.get("LLM_MODEL", "gpt-4o-mini")
LLM_SMALL_MODEL: str = os.environ.get("LLM_SMALL_MODEL", "gpt-4o-mini")
LLM_MAX_TOKENS: int = int(os.environ.get("LLM_MAX_TOKENS", "800"))
LLM_TIMEOUT_S: float = float(os.environ.get("LLM_TIMEOUT_S", "8.0"))
LLM_DAILY_CALLS_PER_BUSINESS: int = int(os.environ.get("LLM_DAILY_CALLS_PER_BUSINESS", "50"))

# In-memory usage counter (per-process; production: use Redis or Postgres counter)
_daily_usage: dict[str, int] = {}


def _usage_key(business_id: str) -> str:
    from datetime import date
    return f"{business_id}:{date.today().isoformat()}"


def _check_budget(business_id: str) -> None:
    key = _usage_key(business_id)
    count = _daily_usage.get(key, 0)
    if count >= LLM_DAILY_CALLS_PER_BUSINESS:
        raise BudgetExceededError(
            f"Daily LLM call limit ({LLM_DAILY_CALLS_PER_BUSINESS}) reached for business {business_id}"
        )


def _increment_usage(business_id: str) -> None:
    key = _usage_key(business_id)
    _daily_usage[key] = _daily_usage.get(key, 0) + 1


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class BudgetExceededError(RuntimeError): ...
class HallucinatedNumberError(ValueError): ...
class LLMTimeoutError(RuntimeError): ...


# ---------------------------------------------------------------------------
# Number Validator
# ---------------------------------------------------------------------------

# Match any number in text: integers, decimals, Bangla digits.
_BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯"
_NUMBER_RE = re.compile(
    r"(?<!\w)"           # not preceded by word char
    r"[\d" + _BANGLA_DIGITS + r"]"
    r"[\d,." + _BANGLA_DIGITS + r"]*"
    r"(?!\w)"
)


def _extract_numbers_from_text(text: str) -> set[str]:
    """Extract all numeric tokens from text (strip commas)."""
    return {m.replace(",", "") for m in _NUMBER_RE.findall(text)}


def _normalise_to_int(tok: str) -> Optional[int]:
    """Try to cast a numeric token to int (handles Bangla digits)."""
    clean = tok.replace(",", "")
    # Convert Bangla digits to ASCII
    for bn, en in zip(_BANGLA_DIGITS, "0123456789"):
        clean = clean.replace(bn, en)
    try:
        return int(float(clean))
    except ValueError:
        return None


def _facts_number_set(facts: dict, _depth: int = 0) -> set[int]:
    """Recursively collect all integer-like values from facts dict."""
    nums: set[int] = set()
    if _depth > 6:
        return nums
    if isinstance(facts, dict):
        for v in facts.values():
            nums |= _facts_number_set(v, _depth + 1)
    elif isinstance(facts, (list, tuple)):
        for item in facts:
            nums |= _facts_number_set(item, _depth + 1)
    elif isinstance(facts, (int, float)) and not isinstance(facts, bool):
        nums.add(int(facts))
    elif isinstance(facts, str):
        n = _normalise_to_int(facts)
        if n is not None:
            nums.add(n)
    return nums


def validate_no_hallucinated_numbers(text: str, facts: dict) -> None:
    """Raise HallucinatedNumberError if any number in text is not in facts.

    Numbers ≤ 9 are always allowed (they appear in date references like
    "৭ দিন", "৩টি" etc. and are low-risk).
    """
    allowed = _facts_number_set(facts)
    tokens = _extract_numbers_from_text(text)
    for tok in tokens:
        n = _normalise_to_int(tok)
        if n is None or n <= 9:
            continue
        if n not in allowed:
            raise HallucinatedNumberError(
                f"LLM output contains number {n!r} (token {tok!r}) "
                f"not found in facts. Possible hallucination."
            )


# ---------------------------------------------------------------------------
# LLM call
# ---------------------------------------------------------------------------

def _call_llm(
    messages: list[dict],
    model: str,
    max_tokens: int,
) -> str:
    """Call OpenAI-compatible API. Returns the first assistant message content."""
    if not LLM_API_KEY:
        raise RuntimeError("LLM_API_KEY not configured.")

    try:
        import openai  # deferred import
    except ImportError:
        raise RuntimeError("openai package not installed; run pip install openai")

    client = openai.OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)

    t0 = time.perf_counter()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.2,
            timeout=LLM_TIMEOUT_S,
        )
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        if elapsed >= LLM_TIMEOUT_S - 0.2:
            raise LLMTimeoutError(f"LLM call timed out after {elapsed:.1f}s") from exc
        raise
    return resp.choices[0].message.content or ""


def llm_complete(
    system_prompt: str,
    user_content: str,
    facts: dict,
    business_id: str = "",
    model: Optional[str] = None,
    max_tokens: Optional[int] = None,
    max_retries: int = 2,
    validate_numbers: bool = True,
    fallback_text: Optional[str] = None,
) -> dict:
    """Primary LLM call with:
    - Budget cap per business.
    - Number validator (validate_numbers=True).
    - Automatic retry with tighter constraint on validation failure.
    - Returns fallback_text if all retries exhausted.

    Returns:
        {text, validated, retries, from_fallback, latency_ms}
    """
    if business_id:
        _check_budget(business_id)

    _model = model or LLM_MODEL
    _max_tokens = max_tokens or LLM_MAX_TOKENS

    # Strict second-attempt system addendum
    STRICT_ADDENDUM = (
        "\n\nCRITICAL: Do NOT write any monetary amounts or statistics. "
        "Use ONLY placeholders like {{key}} from the facts JSON. "
        "Every number you write will be rejected."
    )

    t0 = time.perf_counter()
    last_error: Optional[Exception] = None

    for attempt in range(max_retries + 1):
        sp = system_prompt if attempt == 0 else system_prompt + STRICT_ADDENDUM
        messages = [
            {"role": "system", "content": sp},
            {"role": "user", "content": user_content},
        ]
        try:
            raw = _call_llm(messages, _model, _max_tokens)
            if business_id:
                _increment_usage(business_id)

            if validate_numbers:
                validate_no_hallucinated_numbers(raw, facts)

            latency_ms = int((time.perf_counter() - t0) * 1000)
            return {
                "text": raw,
                "validated": True,
                "retries": attempt,
                "from_fallback": False,
                "latency_ms": latency_ms,
            }
        except HallucinatedNumberError as exc:
            logger.warning("Attempt %d: hallucinated number – %s", attempt + 1, exc)
            last_error = exc
        except LLMTimeoutError as exc:
            logger.warning("LLM timeout on attempt %d", attempt + 1)
            last_error = exc
            break  # No point retrying a timeout
        except Exception as exc:
            logger.error("LLM error: %s", exc)
            last_error = exc
            break

    # All retries exhausted
    latency_ms = int((time.perf_counter() - t0) * 1000)
    fb = fallback_text or ""
    return {
        "text": fb,
        "validated": False,
        "retries": max_retries,
        "from_fallback": True,
        "latency_ms": latency_ms,
        "error": str(last_error),
    }


def llm_json_complete(
    system_prompt: str,
    user_content: str,
    business_id: str = "",
    model: Optional[str] = None,
    max_tokens: int = 300,
) -> dict:
    """LLM call expecting a JSON object in response. Returns parsed dict or {}.
    Used for intent/categorisation where numbers are not expected in the text.
    """
    if business_id:
        _check_budget(business_id)

    _model = model or LLM_SMALL_MODEL
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    try:
        raw = _call_llm(messages, _model, max_tokens)
        if business_id:
            _increment_usage(business_id)
        # Strip markdown code fences if present
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned)
        return json.loads(cleaned)
    except Exception as exc:
        logger.error("llm_json_complete error: %s", exc)
        return {}
