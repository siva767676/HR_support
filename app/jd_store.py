"""JD repository: CRUD + search over the SQLite `jds` table, the company
standard-template formatter, and a Markdown export mirror on disk so the
repository is portable/downloadable.

SQLite is canonical; each finalized JD is also written to JD_EXPORT_DIR/<id>-<slug>.md.
"""

from __future__ import annotations

import re
from pathlib import Path

from . import config, db


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (title or "jd").lower()).strip("-")
    return s or "jd"


def apply_template(fields: dict, body: str) -> str:
    """Wrap a (generated/edited) JD body in the company standard format.

    Matches the My Home Group JD layout: a Job Title / Location / Reporting /
    Company Link header block, the body, and a company footer. Experience and
    skills live inside the body's Qualifications & Skills section (not the header)."""
    title = (fields.get("title") or "Untitled Role").strip()
    location = (fields.get("location") or "").strip() or "—"
    reporting = (fields.get("reporting") or "").strip() or "—"
    site = config.COMPANY_WEBSITE
    return (
        f"| | |\n|---|---|\n"
        f"| **Job Title** | {title} |\n"
        f"| **Location** | {location} |\n"
        f"| **Reporting** | {reporting} |\n"
        f"| **Company Link** | [{site}](https://{site}) |\n\n"
        f"{body.strip()}\n\n"
        f"---\n"
        f"_{config.COMPANY_NAME} · maintained in the JD repository._\n"
    )


def _export(record: dict) -> str:
    """Mirror the JD to disk as Markdown; return the relative export path."""
    Path(config.JD_EXPORT_DIR).mkdir(parents=True, exist_ok=True)
    fname = f"{record['id']}-{_slug(record['title'])}.md"
    (Path(config.JD_EXPORT_DIR) / fname).write_text(record["content"], encoding="utf-8")
    return fname


def _unexport(record: dict) -> None:
    fname = f"{record['id']}-{_slug(record['title'])}.md"
    p = Path(config.JD_EXPORT_DIR) / fname
    if p.exists():
        p.unlink()


# ----------------------------- CRUD -----------------------------

def create_jd(fields: dict, body: str) -> dict:
    """Apply the standard template to `body`, persist, and export to disk."""
    content = apply_template(fields, body)
    jd_id = db.execute(
        """INSERT INTO jds (title, location, reporting, experience, skills,
                            responsibilities, requirements, content)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (fields.get("title", "").strip(), fields.get("location", ""), fields.get("reporting", ""),
         fields.get("experience", ""), fields.get("skills", ""),
         fields.get("responsibilities", ""), fields.get("requirements", ""), content),
    )
    record = get_jd(jd_id)
    _export(record)
    return record


def update_jd(jd_id: int, fields: dict, content: str | None = None) -> dict | None:
    """Update metadata and/or the finalized content (edited directly by the recruiter)."""
    existing = get_jd(jd_id)
    if not existing:
        return None
    new_content = content if content is not None else existing["content"]
    db.execute(
        """UPDATE jds SET title=?, location=?, reporting=?, experience=?, skills=?,
                          responsibilities=?, requirements=?, content=?, updated_at=datetime('now')
           WHERE id=?""",
        (fields.get("title", existing["title"]).strip(),
         fields.get("location", existing["location"]),
         fields.get("reporting", existing["reporting"]),
         fields.get("experience", existing["experience"]),
         fields.get("skills", existing["skills"]),
         fields.get("responsibilities", existing["responsibilities"]),
         fields.get("requirements", existing["requirements"]),
         new_content, jd_id),
    )
    # title may have changed -> remove the old export file, write the new one
    _unexport(existing)
    record = get_jd(jd_id)
    _export(record)
    return record


def get_jd(jd_id: int) -> dict | None:
    return db.query_one("SELECT * FROM jds WHERE id=?", (jd_id,))


def list_jds(search: str | None = None) -> list[dict]:
    if search and search.strip():
        like = f"%{search.strip()}%"
        return db.query(
            """SELECT * FROM jds
               WHERE title LIKE ? OR skills LIKE ? OR content LIKE ?
               ORDER BY updated_at DESC""",
            (like, like, like),
        )
    return db.query("SELECT * FROM jds ORDER BY updated_at DESC")


def delete_jd(jd_id: int) -> bool:
    record = get_jd(jd_id)
    if not record:
        return False
    db.execute("DELETE FROM jds WHERE id=?", (jd_id,))
    _unexport(record)
    return True


def download_name(record: dict) -> str:
    return f"{_slug(record['title'])}.md"
