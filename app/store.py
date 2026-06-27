"""Persistence for completed screening runs and the interviews forwarded from them.

Keeps SQL out of app.main and keeps app.interview_service storage-free (its engine
is deliberately in-memory). The Dashboard and the screening->interview hand-off read
from here, so they survive the in-memory RUNS / _SESSIONS caps and a process restart.

results_json holds the full per-candidate results; resume_text is retained for
SHORTLISTED candidates only (clipped by the caller) so a forwarded interview can be
started server-side without re-uploading the resume.
"""

from __future__ import annotations

import json

from . import db


# --------------------------------- screening -------------------------------------

def save_screening_run(run: dict, jd_id: int | None, role: str, jd_text: str) -> None:
    """Upsert a completed run. Idempotent on run_id (INSERT OR REPLACE)."""
    db.execute(
        """INSERT OR REPLACE INTO screening_runs
           (run_id, jd_id, jd_name, role, jd_text, total, shortlisted, status, results_json,
            created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
               (SELECT created_at FROM screening_runs WHERE run_id = ?), datetime('now')))""",
        (
            run["id"], jd_id, run.get("jd_name", ""), role, jd_text,
            run.get("total", 0), run.get("shortlisted", 0), run.get("status", "complete"),
            json.dumps(run.get("results", [])), run["id"],
        ),
    )


def get_screening_run(run_id: str) -> dict | None:
    """Full run with results_json parsed back into `results`."""
    row = db.query_one("SELECT * FROM screening_runs WHERE run_id = ?", (run_id,))
    if not row:
        return None
    row["results"] = json.loads(row.pop("results_json") or "[]")
    return row


def list_screening_runs(limit: int = 50) -> list[dict]:
    """Lightweight run summaries for the dashboard (no heavy results_json), each with
    a count of distinct candidates that have a completed interview."""
    rows = db.query(
        """SELECT run_id, jd_id, jd_name, role, total, shortlisted, status, created_at
           FROM screening_runs ORDER BY created_at DESC LIMIT ?""",
        (limit,),
    )
    for r in rows:
        done = db.query_one(
            """SELECT COUNT(DISTINCT candidate_key) AS n FROM interviews
               WHERE run_id = ? AND status = 'completed'""",
            (r["run_id"],),
        )
        r["interviewed_count"] = (done or {}).get("n", 0) or 0
    return rows


# --------------------------------- interviews ------------------------------------

def create_interview(
    *, run_id: str | None, candidate_key: str | None,
    candidate_name: str, candidate_email: str | None, role: str,
) -> int:
    """Insert an in-progress interview row; returns its id."""
    return db.execute(
        """INSERT INTO interviews
           (run_id, candidate_key, candidate_name, candidate_email, role, status)
           VALUES (?, ?, ?, ?, ?, 'in_progress')""",
        (run_id, candidate_key, candidate_name, candidate_email, role),
    )


def attach_thread(interview_id: int, thread_id: str) -> None:
    db.execute(
        "UPDATE interviews SET thread_id = ?, updated_at = datetime('now') WHERE id = ?",
        (thread_id, interview_id),
    )


def complete_interview(thread_id: str, report: dict) -> None:
    """Mark the interview for this thread completed and store its report."""
    db.execute(
        """UPDATE interviews
           SET status = 'completed', overall_score = ?, recommendation = ?, report_json = ?,
               updated_at = datetime('now')
           WHERE thread_id = ?""",
        (
            report.get("overall_score"), report.get("recommendation"),
            json.dumps(report), thread_id,
        ),
    )


def expire_interview(thread_id: str) -> None:
    """Mark an interview whose in-memory session was lost (server restart)."""
    db.execute(
        """UPDATE interviews SET status = 'expired', updated_at = datetime('now')
           WHERE thread_id = ? AND status = 'in_progress'""",
        (thread_id,),
    )


def list_interviews(limit: int = 100) -> list[dict]:
    return db.query(
        """SELECT id, thread_id, run_id, candidate_key, candidate_name, candidate_email,
                  role, status, overall_score, recommendation, created_at, updated_at
           FROM interviews ORDER BY updated_at DESC LIMIT ?""",
        (limit,),
    )


def list_interviews_for_run(run_id: str) -> list[dict]:
    return db.query(
        """SELECT id, thread_id, candidate_key, candidate_name, status, overall_score,
                  recommendation, updated_at
           FROM interviews WHERE run_id = ? ORDER BY updated_at DESC""",
        (run_id,),
    )


def completed_candidate_keys(run_id: str) -> set[str]:
    """Distinct candidate_keys with at least one completed interview for this run."""
    rows = db.query(
        """SELECT DISTINCT candidate_key FROM interviews
           WHERE run_id = ? AND status = 'completed' AND candidate_key IS NOT NULL""",
        (run_id,),
    )
    return {r["candidate_key"] for r in rows}
