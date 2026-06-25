"""Shortlist notifications: customizable email templates, per-candidate preview,
and a send path that is DRAFT-ONLY until SMTP is configured (config.EMAIL_ENABLED).

Templates and per-candidate notification records live in SQLite. Rendering uses
{{placeholder}} substitution. Real sending (when enabled) goes through smtplib
with a header-injection guard."""

from __future__ import annotations

import re

from . import config, db, reporting

# Placeholders a recruiter may use in a template.
PLACEHOLDERS = ["candidate_name", "job_title", "company", "score", "recommendation"]

_DEFAULT_NAME = "Shortlist Notification"
_DEFAULT_SUBJECT = "You've been shortlisted for {{job_title}} — {{company}}"
_DEFAULT_BODY = """Dear {{candidate_name}},

Thank you for applying for the {{job_title}} position at {{company}}.

Following our initial screening, we are pleased to inform you that you have been
shortlisted for the next stage of our selection process — our team was impressed
with your profile.

We will be in touch shortly with the details of the next round, which includes an
AI-assisted interview.

Best regards,
Talent Acquisition Team
{{company}}"""

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PLACEHOLDER_RE = re.compile(r"{{\s*(\w+)\s*}}")


# ----------------------------- templates -----------------------------

def ensure_default_template() -> None:
    if not list_templates():
        create_template(_DEFAULT_NAME, _DEFAULT_SUBJECT, _DEFAULT_BODY)


def list_templates() -> list[dict]:
    return db.query("SELECT * FROM email_templates ORDER BY id")


def get_template(tid: int) -> dict | None:
    return db.query_one("SELECT * FROM email_templates WHERE id=?", (tid,))


def default_template() -> dict | None:
    rows = list_templates()
    if not rows:  # lazily re-seed if the repository was emptied at runtime
        ensure_default_template()
        rows = list_templates()
    return rows[0] if rows else None


def create_template(name: str, subject: str, body: str) -> dict:
    tid = db.execute(
        "INSERT INTO email_templates (name, subject, body) VALUES (?, ?, ?)",
        (name.strip() or _DEFAULT_NAME, subject, body),
    )
    return get_template(tid)


def update_template(tid: int, name: str, subject: str, body: str) -> dict | None:
    if not get_template(tid):
        return None
    db.execute(
        "UPDATE email_templates SET name=?, subject=?, body=?, updated_at=datetime('now') WHERE id=?",
        (name.strip() or _DEFAULT_NAME, subject, body, tid),
    )
    return get_template(tid)


def delete_template(tid: int) -> bool:
    if not get_template(tid):
        return False
    db.execute("DELETE FROM email_templates WHERE id=?", (tid,))
    return True


# ----------------------------- rendering -----------------------------

def render(text: str, ctx: dict) -> str:
    """Substitute {{placeholder}} tokens; unknown tokens become empty strings."""
    return _PLACEHOLDER_RE.sub(lambda m: str(ctx.get(m.group(1), "")), text or "")


def candidate_context(run: dict, r: dict) -> dict:
    score = r.get("overall_score")
    return {
        "candidate_name": r.get("candidate_name") or r.get("filename", "Candidate"),
        "job_title": run.get("jd_name", "the role"),
        "company": config.COMPANY_NAME,
        "score": str(score) if score is not None else "",
        "recommendation": r.get("recommendation", ""),
    }


def _valid_email(email: str | None) -> bool:
    return bool(email) and bool(_EMAIL_RE.match(email.strip()))


def build_previews(run: dict, template: dict) -> list[dict]:
    """Render the template for each shortlisted candidate (no persistence)."""
    out = []
    for r in reporting.shortlisted_rows(run):
        ctx = candidate_context(run, r)
        email = (r.get("candidate_email") or "").strip()
        out.append({
            "filename": r.get("filename"),
            "candidate_name": ctx["candidate_name"],
            "email": email,
            "has_email": _valid_email(email),
            "subject": render(template["subject"], ctx),
            "body": render(template["body"], ctx),
        })
    return out


# ----------------------------- sending -----------------------------

def _send_smtp(to: str, subject: str, body: str) -> None:
    import smtplib
    from email.message import EmailMessage

    # Guard against header injection: strip any CR/LF from every header value.
    msg = EmailMessage()
    msg["Subject"] = re.sub(r"[\r\n]+", " ", subject or "").strip()
    msg["From"] = re.sub(r"[\r\n]+", " ", config.SMTP_FROM or "").strip()
    msg["To"] = re.sub(r"[\r\n]+", "", to or "").strip()
    msg.set_content(body)

    # Implicit TLS (465) connects over SSL; otherwise plain + optional STARTTLS.
    if config.SMTP_USE_SSL:
        client = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=30)
    else:
        client = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=30)
    with client as s:
        if config.SMTP_USE_TLS and not config.SMTP_USE_SSL:
            s.starttls()
        if config.SMTP_USER and config.SMTP_PASSWORD:
            s.login(config.SMTP_USER, config.SMTP_PASSWORD)
        s.send_message(msg)


def send_notifications(run: dict, template: dict) -> dict:
    """Render + record a notification per shortlisted candidate.

    Draft mode (no SMTP configured): status='draft', nothing is sent.
    Live mode (EMAIL_ENABLED): actually send; status 'sent' or 'failed'.
    Candidates without a valid email are recorded as 'skipped_no_email'."""
    run_id = run.get("id", "")
    # A re-send supersedes any prior notifications for this run (no duplicate rows).
    db.execute("DELETE FROM notifications WHERE run_id=?", (run_id,))
    counts = {"sent": 0, "drafted": 0, "failed": 0, "skipped_no_email": 0}
    items = []
    for p in build_previews(run, template):
        if not p["has_email"]:
            status, error = "skipped_no_email", "no valid email on resume"
        elif config.EMAIL_ENABLED:
            try:
                _send_smtp(p["email"], p["subject"], p["body"])
                status, error = "sent", None
            except Exception as exc:  # noqa: BLE001 - record, never crash the batch
                status, error = "failed", str(exc)
        else:
            status, error = "draft", None
        counts["drafted" if status == "draft" else status] += 1
        recorded_email = p["email"] if p["has_email"] else ""  # don't store garbage addresses
        db.execute(
            """INSERT INTO notifications (run_id, filename, candidate_name, email, subject, body, status)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (run_id, p["filename"], p["candidate_name"], recorded_email, p["subject"], p["body"], status),
        )
        items.append({**p, "status": status, "error": error})
    return {
        "mode": "live" if config.EMAIL_ENABLED else "draft",
        "counts": counts,
        "total": len(items),
        "items": items,
    }


def list_notifications(run_id: str) -> list[dict]:
    return db.query("SELECT * FROM notifications WHERE run_id=? ORDER BY id", (run_id,))
