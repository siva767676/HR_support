"""AI interview engine: plan -> ask -> evaluate -> (loop) -> report.

Honors the start_interview / submit_answer contract and the PlannedQuestion /
Evaluation / FinalReport schemas from the module spec (CONTEXT.md), but built
directly on this app's existing OpenAI-compatible LLM client (app.evaluator)
with simple in-memory per-thread state rather than LangGraph. This keeps the
dependency surface identical to the rest of the backend. Voice/avatar are out
of scope (text interview only).

State is in-memory only, like the screening RUNS: a process restart drops
in-flight interviews and submit_answer() then raises InterviewExpired. Completed
reports are returned to the caller to persist if desired; nothing is stored here.
"""

from __future__ import annotations

import json
import logging
import uuid

from . import config
from .evaluator import _chat_json

logger = logging.getLogger(__name__)

MAX_QUESTIONS_CAP = 12
MAX_RETAINED_SESSIONS = 50
MAX_FOLLOWUPS_PER_INTERVIEW = 2

# thread_id -> session dict. In-memory only (see module docstring).
_SESSIONS: dict[str, dict] = {}

_VALID_DIFFICULTY = {"easy", "medium", "hard"}
_VALID_ROUND = {"technical", "hr"}
_VALID_RECOMMENDATION = {"Strong Hire", "Hire", "Maybe", "No Hire"}


class InterviewExpired(RuntimeError):
    """submit_answer() called for a thread with no resumable state (e.g. after a
    process restart cleared the in-memory session). Catch it and start a new
    interview to recover."""


# --------------------------------- prompts ----------------------------------

_PLAN_PROMPT = """You are an expert technical interviewer at an engineering and construction company.
Design a focused interview for one candidate.

Role: {role}
Experience level: {level}
{assessment}
Job description:
---
{jd}
---
Candidate resume:
---
{resume}
---

Design exactly {n} questions, ordered from easiest to hardest. Most questions must be
technical and anchored to specific evidence in this candidate's resume and the job
description. Include 1 or 2 HR or behavioural questions. Each question must be answerable
in under three minutes, phrased conversationally, and calibrated to a {level} candidate.

Return ONLY a JSON object of exactly this shape:
{{"questions": [
  {{"topic": "short topic", "question": "the question text", "difficulty": "easy", "round": "technical"}}
]}}
The "questions" array must hold exactly {n} objects, ordered easiest to hardest, where
difficulty is one of easy, medium, hard and round is one of technical, hr.
No preamble, no commentary, no code fences."""

_EVAL_PROMPT = """You are evaluating a single interview answer. Be fair but honest: vague,
empty, or off-topic answers must score low. Calibrate to a {level} candidate for the role of {role}.

Question ({round}, {difficulty}): {question}

Candidate's answer:
---
{answer}
---

Return ONLY a JSON object:
{{
  "technical_score": 0,
  "communication_score": 0,
  "completeness_score": 0,
  "confidence_score": 0,
  "problem_solving_score": 0,
  "analytical_thinking_score": 0,
  "domain_expertise_score": 0,
  "evidence": {{}},
  "missing_points": ["what a strong answer should have covered but did not"],
  "suggested_answer": "a concise model answer",
  "follow_up_needed": false,
  "follow_up_question": null
}}

Scores are integers 0-10:
- technical_score: accuracy and depth of technical knowledge demonstrated
- communication_score: clarity, structure, and articulation
- completeness_score: how thoroughly the question was addressed
- confidence_score: assertiveness and certainty in delivery
- problem_solving_score: logical approach, structured thinking
- analytical_thinking_score: data-driven reasoning, analysis of trade-offs, inferences drawn
- domain_expertise_score: industry-specific knowledge relevant to {role}

"evidence": map up to 3 dimension keys (e.g. "technical", "problem_solving") to a short verbatim quote (≤20 words) from the answer supporting the score. Omit dimensions with no notable evidence.
"follow_up_needed": true only if the answer was vague, incomplete, or evasive on a critical point.
"follow_up_question": if follow_up_needed is true, write a focused follow-up on the same topic (one level deeper); otherwise null.
No commentary, no code fences."""

_REPORT_PROMPT = """You are writing the final interview report for a {role} candidate
(experience level: {level}). Weigh the full transcript below; reward depth and clarity,
penalise vagueness and gaps.

Transcript (each item has the question and the per-answer scores you gave):
{transcript}

Return ONLY a JSON object:
{{
  "overall_score": 0,
  "technical_skills": 0,
  "communication": 0,
  "confidence": 0,
  "problem_solving": 0,
  "analytical_thinking": 0,
  "domain_expertise": 0,
  "strengths": ["concrete strength"],
  "weaknesses": ["concrete weakness"],
  "flags": [],
  "recommendation": "Hire",
  "summary": "two or three sentence overall assessment"
}}
overall_score is an integer from 0 to 100; the six dimension scores are numbers from 0 to 10;
recommendation is exactly one of: Strong Hire, Hire, Maybe, No Hire.
"flags": list up to 3 short integrity or consistency concerns (e.g. "Claimed Python expertise but struggled with basic syntax"). Return an empty array if none.
No commentary, no code fences."""


# --------------------------------- helpers ----------------------------------

def _clip(text: str, max_chars: int) -> str:
    return (text or "").strip()[:max_chars]


def _as_int(value, lo: int, hi: int, default: int = 0) -> int:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _as_num(value, lo: float, hi: float, default: float = 0.0) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    return round(max(lo, min(hi, n)), 1)


def _as_list(value) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _as_dict(value) -> dict:
    """Tolerate a stray non-object LLM reply (the json-mode 400 fallback can emit
    a bare array): unwrap a single-object list, otherwise degrade to {} so cleaning
    yields safe defaults instead of an AttributeError."""
    if isinstance(value, dict):
        return value
    if isinstance(value, list) and value and isinstance(value[0], dict):
        return value[0]
    return {}


def _clean_question(raw: dict, index: int) -> dict:
    difficulty = str(raw.get("difficulty", "")).lower().strip()
    rnd = str(raw.get("round", "")).lower().strip()
    return {
        "topic": str(raw.get("topic") or f"Question {index + 1}").strip(),
        "question": str(raw.get("question") or "").strip(),
        "difficulty": difficulty if difficulty in _VALID_DIFFICULTY else "medium",
        "round": rnd if rnd in _VALID_ROUND else "technical",
    }


def _clean_evaluation(raw) -> dict:
    raw = _as_dict(raw)
    ev = raw.get("evidence")
    fq = str(raw.get("follow_up_question") or "").strip()
    return {
        "technical_score": _as_int(raw.get("technical_score"), 0, 10),
        "communication_score": _as_int(raw.get("communication_score"), 0, 10),
        "completeness_score": _as_int(raw.get("completeness_score"), 0, 10),
        "confidence_score": _as_int(raw.get("confidence_score"), 0, 10),
        "problem_solving_score": _as_int(raw.get("problem_solving_score"), 0, 10),
        "analytical_thinking_score": _as_int(raw.get("analytical_thinking_score"), 0, 10),
        "domain_expertise_score": _as_int(raw.get("domain_expertise_score"), 0, 10),
        "evidence": ev if isinstance(ev, dict) else {},
        "missing_points": _as_list(raw.get("missing_points")),
        "suggested_answer": str(raw.get("suggested_answer") or "").strip(),
        "follow_up_needed": bool(raw.get("follow_up_needed", False)),
        "follow_up_question": fq or None,
    }


def _adapt_difficulty(sess: dict) -> bool:
    """After each answer, nudge the remaining questions' difficulty up or down
    based on the last two answers' combined technical + problem_solving average.
    Returns True when any question was changed (frontend can show a badge)."""
    transcript = sess["transcript"]
    if len(transcript) < 2:
        return False
    recent = transcript[-2:]
    avg = sum(
        (t["evaluation"]["technical_score"] + t["evaluation"]["problem_solving_score"]) / 2
        for t in recent
    ) / 2
    remaining = sess["questions"][sess["idx"]:]
    changed = False
    if avg >= 7.5:
        for q in remaining:
            if not q.get("is_followup"):
                if q["difficulty"] == "easy":
                    q["difficulty"] = "medium"
                    changed = True
                elif q["difficulty"] == "medium":
                    q["difficulty"] = "hard"
                    changed = True
    elif avg <= 3.5:
        for q in remaining:
            if not q.get("is_followup"):
                if q["difficulty"] == "hard":
                    q["difficulty"] = "medium"
                    changed = True
                elif q["difficulty"] == "medium":
                    q["difficulty"] = "easy"
                    changed = True
    return changed


def _clean_report(raw) -> dict:
    raw = _as_dict(raw)
    rec = str(raw.get("recommendation") or "").strip()
    return {
        "overall_score": _as_int(raw.get("overall_score"), 0, 100),
        "technical_skills": _as_num(raw.get("technical_skills"), 0, 10),
        "communication": _as_num(raw.get("communication"), 0, 10),
        "confidence": _as_num(raw.get("confidence"), 0, 10),
        "problem_solving": _as_num(raw.get("problem_solving"), 0, 10),
        "analytical_thinking": _as_num(raw.get("analytical_thinking"), 0, 10),
        "domain_expertise": _as_num(raw.get("domain_expertise"), 0, 10),
        "strengths": _as_list(raw.get("strengths")),
        "weaknesses": _as_list(raw.get("weaknesses")),
        "flags": _as_list(raw.get("flags")),
        "recommendation": rec if rec in _VALID_RECOMMENDATION else "Maybe",
        "summary": str(raw.get("summary") or "").strip(),
    }


# ----------------------------- engine surface --------------------------------

async def start_interview(
    *,
    candidate_name: str,
    role: str,
    experience_level: str,
    resume_text: str,
    job_description: str,
    assessment_summary: str = "",
    max_questions: int = 5,
) -> dict:
    """Plan the interview and return the first question.

    Returns {"thread_id": str, "question": <PlannedQuestion>}.
    """
    n = max(1, min(int(max_questions or 5), MAX_QUESTIONS_CAP))
    assessment = (
        f"Prior assessment summary: {assessment_summary.strip()}\n"
        if assessment_summary and assessment_summary.strip()
        else ""
    )
    prompt = _PLAN_PROMPT.format(
        role=role or "(unspecified)",
        level=experience_level or "mid",
        assessment=assessment,
        jd=_clip(job_description, config.MAX_JD_CHARS),
        resume=_clip(resume_text, config.MAX_DOC_CHARS),
        n=n,
    )
    raw = await _chat_json(prompt)
    # Expect {"questions": [...]}; tolerate a bare list or a single-object reply.
    if isinstance(raw, dict):
        items = raw.get("questions")
        if not isinstance(items, list):
            items = [raw]
    elif isinstance(raw, list):
        items = raw
    else:
        items = []
    questions = [_clean_question(q, i) for i, q in enumerate(items) if isinstance(q, dict)]
    questions = [q for q in questions if q["question"]][:n]
    if not questions:
        raise ValueError("The interviewer could not plan any questions for these inputs")

    thread_id = uuid.uuid4().hex[:12]
    _SESSIONS[thread_id] = {
        "thread_id": thread_id,
        "candidate_name": (candidate_name or "Candidate").strip(),
        "role": role,
        "level": experience_level or "mid",
        "questions": questions,
        "idx": 0,
        "transcript": [],
        "report": None,
        "follow_up_count": 0,
    }
    # Bound retained sessions so a long-lived server doesn't grow unbounded.
    while len(_SESSIONS) > MAX_RETAINED_SESSIONS:
        _SESSIONS.pop(next(iter(_SESSIONS)))

    return {"thread_id": thread_id, "question": questions[0], "total_questions": len(questions)}


async def submit_answer(thread_id: str, answer: str) -> dict:
    """Score the answer to the current question, then return the next question
    or, when the interview is finished, the FinalReport.

    Returns {thread_id, last_turn, question|None, transcript, report|None, done}.
    Raises InterviewExpired if the thread is unknown (state was lost).
    """
    sess = _SESSIONS.get(thread_id)
    if sess is None:
        raise InterviewExpired(thread_id)
    # Mark recently-used so the retention cap evicts genuinely idle sessions
    # (least-recently-used), never the interview we are actively serving.
    _SESSIONS[thread_id] = _SESSIONS.pop(thread_id)

    # Idempotent on an already-finished interview. If a prior final-report build
    # failed (a transient LLM error), the session is finished with report=None;
    # rebuild it on retry so one hiccup can't permanently strand the report.
    if sess["idx"] >= len(sess["questions"]):
        if sess.get("report") is None and sess["transcript"]:
            sess["report"] = await _build_report(sess)
        return {
            "thread_id": thread_id,
            "last_turn": sess["transcript"][-1] if sess["transcript"] else None,
            "question": None,
            "transcript": sess["transcript"],
            "report": sess.get("report"),
            "done": True,
            "total_questions": len(sess["questions"]),
            "difficulty_adapted": False,
        }

    question = sess["questions"][sess["idx"]]
    evaluation = _clean_evaluation(
        await _chat_json(
            _EVAL_PROMPT.format(
                role=sess["role"] or "(unspecified)",
                level=sess["level"],
                round=question["round"],
                difficulty=question["difficulty"],
                question=question["question"],
                answer=_clip(answer, config.MAX_DOC_CHARS) or "(no answer given)",
            )
        )
    )
    turn = {"question": question, "answer": (answer or "").strip(), "evaluation": evaluation}
    sess["transcript"].append(turn)
    sess["idx"] += 1

    # Inject a follow-up question right after this one when the LLM flagged a gap,
    # but cap total injections so a weak candidate can't extend the session forever.
    if (
        evaluation.get("follow_up_needed")
        and evaluation.get("follow_up_question")
        and sess["follow_up_count"] < MAX_FOLLOWUPS_PER_INTERVIEW
    ):
        follow_up = {
            "topic": question.get("topic", "Follow-up"),
            "question": evaluation["follow_up_question"],
            "difficulty": question.get("difficulty", "medium"),
            "round": question.get("round", "technical"),
            "is_followup": True,
        }
        sess["questions"].insert(sess["idx"], follow_up)
        sess["follow_up_count"] += 1

    # Nudge remaining question difficulties up/down based on recent performance trend.
    difficulty_adapted = _adapt_difficulty(sess)

    if sess["idx"] < len(sess["questions"]):
        return {
            "thread_id": thread_id,
            "last_turn": turn,
            "question": sess["questions"][sess["idx"]],
            "transcript": sess["transcript"],
            "report": None,
            "done": False,
            "total_questions": len(sess["questions"]),
            "difficulty_adapted": difficulty_adapted,
        }

    report = await _build_report(sess)
    sess["report"] = report
    return {
        "thread_id": thread_id,
        "last_turn": turn,
        "question": None,
        "transcript": sess["transcript"],
        "report": report,
        "done": True,
        "total_questions": len(sess["questions"]),
        "difficulty_adapted": False,
    }


async def _build_report(sess: dict) -> dict:
    summary = [
        {
            "question": t["question"]["question"],
            "round": t["question"]["round"],
            "scores": {
                k: v for k, v in t["evaluation"].items()
                if k.endswith("_score")
            },
        }
        for t in sess["transcript"]
    ]
    raw = await _chat_json(
        _REPORT_PROMPT.format(
            role=sess["role"] or "(unspecified)",
            level=sess["level"],
            transcript=json.dumps(summary, indent=2),
        )
    )
    return _clean_report(raw)
