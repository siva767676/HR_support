"""SQLite storage for the recruitment platform.

Canonical store for the JD repository (and, in later phases, candidates and
interviews). Uses stdlib sqlite3 — no extra dependency, no server. The DB path is
configurable via DB_PATH; the parent directory is created on init.

A new connection is opened per call (sqlite is fine for this LAN-scale app and
this avoids cross-thread/connection-reuse pitfalls under FastAPI's threadpool).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from . import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jds (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    location      TEXT,
    reporting     TEXT,
    experience    TEXT,
    skills        TEXT,            -- comma-separated, as entered
    responsibilities TEXT,
    requirements  TEXT,
    content       TEXT NOT NULL,   -- the finalized, formatted JD (Markdown)
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

_SCHEMA += """
CREATE TABLE IF NOT EXISTS email_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id         TEXT NOT NULL,
    filename       TEXT,
    candidate_name TEXT,
    email          TEXT,
    subject        TEXT,
    body           TEXT,
    status         TEXT NOT NULL DEFAULT 'draft',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# Pipeline persistence: completed screening runs and the interviews forwarded from
# them, so the Dashboard survives a server restart (the in-memory RUNS / interview
# _SESSIONS do not). results_json keeps each candidate's resume_text for SHORTLISTED
# rows only (clipped) so a forwarded interview can be started without re-upload.
_SCHEMA += """
CREATE TABLE IF NOT EXISTS screening_runs (
    run_id       TEXT PRIMARY KEY,
    jd_id        INTEGER,
    jd_name      TEXT NOT NULL,
    role         TEXT,
    jd_text      TEXT,
    total        INTEGER NOT NULL DEFAULT 0,
    shortlisted  INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'complete',
    results_json TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS interviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id      TEXT,
    run_id         TEXT,
    candidate_key  TEXT,
    candidate_name TEXT,
    candidate_email TEXT,
    role           TEXT,
    status         TEXT NOT NULL DEFAULT 'in_progress',
    overall_score  INTEGER,
    recommendation TEXT,
    report_json    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interviews_run ON interviews(run_id);
CREATE INDEX IF NOT EXISTS idx_interviews_thread ON interviews(thread_id);
"""

# Columns added after the first schema version — applied to pre-existing DBs.
_MIGRATIONS = {"jds": {"location": "TEXT", "reporting": "TEXT"}}


def _connect() -> sqlite3.Connection:
    Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Create tables if missing and apply column migrations. Idempotent."""
    with _connect() as conn:
        conn.executescript(_SCHEMA)
        for table, cols in _MIGRATIONS.items():
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            for col, decl in cols.items():
                if col not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
        conn.commit()


def query(sql: str, params: tuple = ()) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def query_one(sql: str, params: tuple = ()) -> dict | None:
    with _connect() as conn:
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None


def execute(sql: str, params: tuple = ()) -> int:
    """Run a write; return lastrowid (for INSERT) or rowcount (for UPDATE/DELETE)."""
    with _connect() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid if cur.lastrowid else cur.rowcount
