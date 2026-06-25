"""JD repository tests — CRUD, search, and standard-template formatting.
Uses a temp DB/export dir so the real repository is never touched. No LLM."""

import importlib

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(config, "JD_EXPORT_DIR", str(tmp_path / "jds"))
    monkeypatch.setattr(config, "COMPANY_NAME", "Acme Corp")
    from app import db, jd_store
    importlib.reload(db)          # not strictly needed (path read at call time) but explicit
    db.init_db()
    return jd_store


def test_apply_template_company_header_and_body(store):
    out = store.apply_template(
        {"title": "GET - PMO", "location": "Hyderabad", "reporting": "Head - PMO"},
        "## About the Opportunity\nGreat role.",
    )
    # company-standard header block + footer
    assert "**Job Title**" in out and "GET - PMO" in out
    assert "**Location**" in out and "Hyderabad" in out
    assert "**Reporting**" in out and "Head - PMO" in out
    assert "Company Link" in out
    assert "Acme Corp" in out          # COMPANY_NAME footer
    assert "Great role." in out        # body preserved


def test_apply_template_missing_optional_fields(store):
    out = store.apply_template({"title": "Analyst"}, "body")
    assert "Analyst" in out and "| **Location** | — |" in out


def test_create_get_and_export(store, tmp_path):
    rec = store.create_jd(
        {"title": "QA Lead", "experience": "6+ yrs", "skills": "Selenium"},
        "## Role Overview\nOwn quality.",
    )
    assert rec["id"] >= 1
    got = store.get_jd(rec["id"])
    assert got["title"] == "QA Lead" and "Own quality." in got["content"]
    # exported to disk
    exported = list((tmp_path / "jds").glob("*.md"))
    assert len(exported) == 1 and "qa-lead" in exported[0].name


def test_search_matches_title_skills_content(store):
    store.create_jd({"title": "Python Dev", "skills": "Python, FastAPI"}, "Backend role.")
    store.create_jd({"title": "React Dev", "skills": "React, TS"}, "Frontend role.")
    assert {j["title"] for j in store.list_jds("python")} == {"Python Dev"}
    assert {j["title"] for j in store.list_jds("Dev")} == {"Python Dev", "React Dev"}
    assert store.list_jds("nonsense") == []


def test_update_changes_content_and_reexports(store, tmp_path):
    rec = store.create_jd({"title": "Old Title", "skills": "x"}, "body")
    upd = store.update_jd(rec["id"], {"title": "New Title", "skills": "y"},
                          content="brand new content")
    assert upd["title"] == "New Title" and upd["content"] == "brand new content"
    names = sorted(p.name for p in (tmp_path / "jds").glob("*.md"))
    assert any("new-title" in n for n in names)
    assert not any("old-title" in n for n in names)  # stale export removed


def test_delete_removes_record_and_file(store, tmp_path):
    rec = store.create_jd({"title": "Temp Role", "skills": "z"}, "body")
    assert store.delete_jd(rec["id"]) is True
    assert store.get_jd(rec["id"]) is None
    assert list((tmp_path / "jds").glob("*.md")) == []
    assert store.delete_jd(rec["id"]) is False  # already gone
