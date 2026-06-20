import asyncio
import json
import logging
import re

import httpx

from . import config

logger = logging.getLogger(__name__)

# HTTP statuses worth retrying — transient server/overload conditions. Others
# (401/404/422 …) signal a real misconfiguration that a retry won't fix.
_RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}

_JD_PROMPT = """You are an expert technical recruiter. Extract the key requirements from the job description below.

Return ONLY a JSON object with these keys:
- "job_title": string
- "required_skills": list of strings
- "preferred_skills": list of strings
- "min_years_experience": number or null
- "education_requirements": list of strings
- "certifications": list of strings
- "domain": string (industry/domain of the role)
- "key_responsibilities": list of strings

Job description:
---
{jd}
---"""

_EVAL_PROMPT = """You are a technical recruiter. Evaluate this resume against the job requirements.
Base all assessments on resume evidence only. Be strict: missing required skills → score below 50.

Requirements:
{requirements}

Resume:
---
{resume}
---

Return only JSON:
{{
  "candidate_name": "string or null",
  "scores": {{"skills_match": 0-100, "experience_match": 0-100, "education_certifications": 0-100, "domain_relevance": 0-100, "projects_achievements": 0-100}},
  "required_skills_matched": ["skill1", "skill2"],
  "required_skills_missing": ["skill1", "skill2"],
  "preferred_skills_matched": ["skill1"],
  "years_experience_estimate": "number or null",
  "strengths": ["point1", "point2", "point3"],
  "missing_requirements": ["gap1", "gap2"],
  "summary": "one sentence assessment"
}}"""


async def extract_jd_requirements(jd_text: str) -> dict:
    # Use the larger JD budget so multiple concatenated JD files aren't truncated.
    return await _chat_json(_JD_PROMPT.format(jd=jd_text[: config.MAX_JD_CHARS]))


async def evaluate_resume(jd_text: str, requirements: dict, resume_text: str) -> dict:
    prompt = _EVAL_PROMPT.format(
        requirements=json.dumps(requirements, indent=2),
        resume=resume_text[: config.MAX_DOC_CHARS],
    )
    return await _chat_json(prompt)


async def evaluate_resumes_batch(
    jd_text: str, requirements: dict, resumes: list[tuple[str, str]]
) -> list[dict]:
    """Evaluate multiple resumes in a single batch call.

    Args:
        jd_text: Job description text
        requirements: Extracted JD requirements dict
        resumes: List of (filename, resume_text) tuples

    Returns:
        List of evaluation results (same order as input)
    """
    if not resumes:
        return []
    if len(resumes) == 1:
        return [await evaluate_resume(jd_text, requirements, resumes[0][1])]

    # Build batch prompt
    resume_blocks = "\n---CANDIDATE---\n".join(
        f"[{name}]\n{text[: config.MAX_DOC_CHARS]}"
        for name, text in resumes
    )

    batch_prompt = f"""You are a technical recruiter. Evaluate these resumes against the job requirements.
Base all assessments on resume evidence only. Be strict: missing required skills → score below 50.

Requirements:
{json.dumps(requirements, indent=2)}

Resumes:
---CANDIDATE---
{resume_blocks}

Return ONLY a JSON array with one evaluation object per resume, in the same order. Each object:
{{
  "candidate_name": "string or null",
  "scores": {{"skills_match": 0-100, "experience_match": 0-100, "education_certifications": 0-100, "domain_relevance": 0-100, "projects_achievements": 0-100}},
  "required_skills_matched": ["skill1"],
  "required_skills_missing": ["skill1"],
  "preferred_skills_matched": ["skill1"],
  "years_experience_estimate": "number or null",
  "strengths": ["point1", "point2"],
  "missing_requirements": ["gap1"],
  "summary": "one sentence assessment"
}}"""

    # A single garbled/truncated array would otherwise doom the whole batch (the
    # array parser has no repair). On any failure OR a count mismatch, fall back
    # to the robust per-resume path so candidates' fates are decoupled.
    try:
        result = await _chat_json_array(batch_prompt)
    except Exception as exc:
        logger.warning("Batch evaluation failed (%s); falling back to per-resume", exc)
        return await _eval_individually(jd_text, requirements, resumes)

    if len(result) != len(resumes):
        logger.warning(
            "Batch returned %d results for %d resumes; falling back to per-resume",
            len(result),
            len(resumes),
        )
        return await _eval_individually(jd_text, requirements, resumes)
    return result


async def _eval_individually(
    jd_text: str, requirements: dict, resumes: list[tuple[str, str]]
) -> list[dict | None]:
    """Evaluate each resume on its own via the robust single-eval path.

    Returns a list the same length as ``resumes`` (None marks a failed item), so a
    failed batch can't strand or mis-align unrelated candidates.
    """
    async def _one(text: str):
        try:
            return await evaluate_resume(jd_text, requirements, text)
        except Exception as exc:
            logger.warning("Per-resume fallback evaluation failed: %s", exc)
            return None

    return await asyncio.gather(*(_one(text) for _, text in resumes))


async def _chat_json_array(prompt: str) -> list[dict]:
    """Call LLM expecting a JSON array response."""
    headers = {"Authorization": f"Bearer {config.VLLM_API_KEY}"}
    max_tokens = config.MAX_OUTPUT_TOKENS
    last_error = "no attempts made"

    for attempt in range(config.LLM_MAX_RETRIES + 1):
        if attempt:
            await asyncio.sleep(min(2 ** (attempt - 1), 8))
        try:
            content, truncated = await _request_content(prompt, headers, max_tokens)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in _RETRYABLE_STATUS:
                raise
            last_error = f"HTTP {exc.response.status_code}"
            logger.warning("LLM request failed (%s), retrying", last_error)
            continue
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            logger.warning("LLM request failed (%s), retrying", last_error)
            continue

        if truncated and attempt < config.LLM_MAX_RETRIES:
            max_tokens = min(max_tokens * 2, config.MAX_OUTPUT_TOKENS_CAP)
            last_error = "response truncated at token limit"
            logger.warning("LLM response truncated, raising budget to %d", max_tokens)
            continue

        try:
            return _parse_json_array(content)
        except ValueError as exc:
            last_error = str(exc)
            logger.warning("LLM response not parseable, retrying: %s", last_error)
            continue

    raise ValueError(
        f"LLM evaluation failed after {config.LLM_MAX_RETRIES + 1} attempts: {last_error}"
    )


async def _chat_json(prompt: str) -> dict:
    """Call the LLM and return parsed JSON, retrying transient failures.

    Each evaluation gets several attempts: network errors, retryable HTTP
    statuses and unparseable responses are retried with exponential backoff,
    and a truncated response (hit the token ceiling) grows the budget before
    retrying. Only the final failure is propagated to the caller.
    """
    headers = {"Authorization": f"Bearer {config.VLLM_API_KEY}"}
    max_tokens = config.MAX_OUTPUT_TOKENS
    last_error = "no attempts made"

    for attempt in range(config.LLM_MAX_RETRIES + 1):
        if attempt:
            await asyncio.sleep(min(2 ** (attempt - 1), 8))
        try:
            content, truncated = await _request_content(prompt, headers, max_tokens)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in _RETRYABLE_STATUS:
                raise
            last_error = f"HTTP {exc.response.status_code}"
            logger.warning("LLM request failed (%s), retrying", last_error)
            continue
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            logger.warning("LLM request failed (%s), retrying", last_error)
            continue

        # Truncated output is almost certainly unparseable JSON — give the model
        # more room and try again rather than wasting the attempt on a parse.
        if truncated and attempt < config.LLM_MAX_RETRIES:
            max_tokens = min(max_tokens * 2, config.MAX_OUTPUT_TOKENS_CAP)
            last_error = "response truncated at token limit"
            logger.warning("LLM response truncated, raising budget to %d", max_tokens)
            continue

        try:
            return _parse_json(content)
        except ValueError as exc:
            last_error = str(exc)
            logger.warning("LLM response not parseable, retrying: %s", last_error)
            continue

    raise ValueError(
        f"LLM evaluation failed after {config.LLM_MAX_RETRIES + 1} attempts: {last_error}"
    )


async def _request_content(prompt: str, headers: dict, max_tokens: int) -> tuple[str, bool]:
    """Return (content, truncated) from one chat-completion call."""
    payload = {
        "model": config.VLLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }
    # generous timeout: Ollama/vLLM may queue concurrent requests serially
    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post(
            f"{config.VLLM_BASE_URL}/chat/completions",
            headers=headers,
            json={**payload, "response_format": {"type": "json_object"}},
        )
        if resp.status_code == 400:
            # server/model without JSON-mode support — retry as plain completion
            resp = await client.post(
                f"{config.VLLM_BASE_URL}/chat/completions", headers=headers, json=payload
            )
        resp.raise_for_status()
    choice = resp.json()["choices"][0]
    content = choice["message"]["content"]
    truncated = choice.get("finish_reason") == "length"
    return content, truncated


def _parse_json_array(content: str) -> list[dict]:
    """Parse a JSON array from model output."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
    try:
        result = json.loads(cleaned)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        pass
    # Try to extract array from prose
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if match:
        try:
            result = json.loads(match.group(0))
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass
    raise ValueError(f"Model did not return valid JSON array: {content[:200]!r}")


def _parse_json(content: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # prose around a complete object: grab the outermost {...}
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    # truncated/partial object: best-effort repair (close strings & brackets,
    # drop the dangling final field) so we keep what the model did produce
    repaired = _repair_object(cleaned)
    if repaired is not None:
        return json.loads(repaired)
    raise ValueError(f"Model did not return valid JSON: {content[:200]!r}")


def _repair_object(text: str) -> str | None:
    """Best-effort reconstruction of a truncated JSON object.

    Tries the text as-is, then progressively drops the (incomplete) tail after
    each top-level comma, closing any open string and brackets, until something
    parses. Returns the repaired JSON string, or None if nothing parses.
    """
    start = text.find("{")
    if start == -1:
        return None
    base = text[start:]
    for candidate in (base, *(base[:c] for c in reversed(_comma_positions(base)))):
        closer = _closer_for(candidate)
        if closer is None:
            continue
        repaired = candidate + closer
        try:
            json.loads(repaired)
            return repaired
        except json.JSONDecodeError:
            continue
    return None


def _comma_positions(s: str) -> list[int]:
    """Indices of commas that sit outside any string literal."""
    positions, in_str, escape = [], False, False
    for i, ch in enumerate(s):
        if escape:
            escape = False
        elif ch == "\\":
            escape = True
        elif ch == '"':
            in_str = not in_str
        elif ch == "," and not in_str:
            positions.append(i)
    return positions


def _closer_for(s: str) -> str | None:
    """The closing sequence needed to balance s, or None if it can't balance."""
    stack, in_str, escape = [], False, False
    for ch in s:
        if escape:
            escape = False
        elif ch == "\\":
            escape = True
        elif ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch in "{[":
                stack.append("}" if ch == "{" else "]")
            elif ch in "}]":
                if not stack:
                    return None
                stack.pop()
    return ('"' if in_str else "") + "".join(reversed(stack))
