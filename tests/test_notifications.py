"""Shortlist notifications — rendering, previews (skip no-email), draft-mode
send + status recording, template CRUD, and the header-injection guard."""

import pytest


@pytest.fixture()
def notif(tmp_path, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "n.db"))
    monkeypatch.setattr(config, "COMPANY_NAME", "Acme Corp")
    monkeypatch.setattr(config, "EMAIL_ENABLED", False)  # draft mode
    from app import db, notifications
    db.init_db()
    notifications.ensure_default_template()
    return notifications


RUN = {
    "id": "run1",
    "jd_name": "Site Engineer",
    "results": [
        {"filename": "a.pdf", "candidate_name": "Alice", "candidate_email": "alice@x.com",
         "shortlisted": True, "overall_score": 88, "similarity": 0.9, "recommendation": "Strong Match"},
        {"filename": "b.pdf", "candidate_name": "Bob", "candidate_email": "",
         "shortlisted": True, "overall_score": 70, "similarity": 0.8, "recommendation": "Good Match"},
        {"filename": "c.pdf", "candidate_name": "Carol", "shortlisted": False,
         "overall_score": None, "similarity": 0.2, "recommendation": "Not shortlisted"},
    ],
}

# Two shortlisted candidates, both with valid emails (for live/batch tests).
RUN2 = {
    "id": "run2",
    "jd_name": "Site Engineer",
    "results": [
        {"filename": "a.pdf", "candidate_name": "Alice", "candidate_email": "alice@x.com",
         "shortlisted": True, "overall_score": 88, "similarity": 0.9, "recommendation": "Strong Match"},
        {"filename": "d.pdf", "candidate_name": "Dave", "candidate_email": "dave@x.com",
         "shortlisted": True, "overall_score": 64, "similarity": 0.7, "recommendation": "Good Match"},
    ],
}


def _fake_smtp_class(captured, raise_exc=None):
    """A monkeypatch-able SMTP stand-in that records sent messages (or raises)."""
    class FakeSMTP:
        def __init__(self, *a, **k):
            captured.setdefault("opened", 0)
            captured["opened"] += 1

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            pass

        def login(self, *a):
            captured["logged_in"] = True

        def send_message(self, msg):
            if raise_exc:
                raise raise_exc
            captured.setdefault("messages", []).append(msg)

    return FakeSMTP


def test_render_substitutes_placeholders(notif):
    out = notif.render("Hi {{candidate_name}}, role {{ job_title }} at {{company}}.",
                       {"candidate_name": "Alice", "job_title": "SE", "company": "Acme"})
    assert out == "Hi Alice, role SE at Acme."
    # unknown placeholder -> empty
    assert notif.render("x {{nope}} y", {}) == "x  y"


def test_default_template_seeded(notif):
    tmpls = notif.list_templates()
    assert len(tmpls) == 1
    assert "{{job_title}}" in tmpls[0]["subject"] or "{{job_title}}" in tmpls[0]["body"]


def test_build_previews_only_shortlisted_and_email_flag(notif):
    t = notif.default_template()
    previews = notif.build_previews(RUN, t)
    assert [p["candidate_name"] for p in previews] == ["Alice", "Bob"]  # Carol not shortlisted
    by_name = {p["candidate_name"]: p for p in previews}
    assert by_name["Alice"]["has_email"] is True
    assert by_name["Bob"]["has_email"] is False
    assert "Site Engineer" in by_name["Alice"]["subject"]
    assert "Alice" in by_name["Alice"]["body"]


def test_send_draft_mode_records_status(notif):
    t = notif.default_template()
    res = notif.send_notifications(RUN, t)
    assert res["mode"] == "draft"
    assert res["counts"]["drafted"] == 1          # Alice
    assert res["counts"]["skipped_no_email"] == 1  # Bob
    assert res["counts"]["sent"] == 0
    recorded = notif.list_notifications("run1")
    assert len(recorded) == 2
    assert {r["status"] for r in recorded} == {"draft", "skipped_no_email"}


def test_template_crud(notif):
    rec = notif.create_template("Custom", "Hi {{candidate_name}}", "Body {{company}}")
    assert rec["id"] and rec["name"] == "Custom"
    upd = notif.update_template(rec["id"], "Custom2", "S", "B")
    assert upd["name"] == "Custom2"
    assert notif.delete_template(rec["id"]) is True
    assert notif.get_template(rec["id"]) is None
    assert notif.delete_template(rec["id"]) is False


def test_send_smtp_strips_header_injection(notif, monkeypatch):
    import smtplib
    from app import config
    monkeypatch.setattr(config, "SMTP_FROM", "hr@acme.com")
    captured = {}
    monkeypatch.setattr(smtplib, "SMTP", _fake_smtp_class(captured))

    # CRLF in recipient/subject must not smuggle extra headers
    notif._send_smtp("alice@x.com\r\nBcc: evil@x.com", "Hello\r\nX-Injected: 1", "body")
    msg = captured["messages"][0]
    # No CRLF leaks into any header, and the injected "Bcc:" did not become a real header.
    assert "\n" not in msg["Subject"] and "\r" not in msg["Subject"]
    assert "\n" not in msg["To"] and "\r" not in msg["To"]
    assert msg["Bcc"] is None                           # no smuggled Bcc recipient
    assert msg["From"] == "hr@acme.com"


def test_send_live_mode_marks_sent(notif, monkeypatch):
    import smtplib
    from app import config
    monkeypatch.setattr(config, "EMAIL_ENABLED", True)
    monkeypatch.setattr(config, "SMTP_HOST", "smtp.test")
    captured = {}
    monkeypatch.setattr(smtplib, "SMTP", _fake_smtp_class(captured))

    res = notif.send_notifications(RUN, notif.default_template())
    assert res["mode"] == "live"
    assert res["counts"] == {"sent": 1, "drafted": 0, "failed": 0, "skipped_no_email": 1}
    assert len(captured["messages"]) == 1                       # only Alice (Bob has no email)
    assert captured["messages"][0]["To"] == "alice@x.com"
    statuses = {r["status"] for r in notif.list_notifications("run1")}
    assert statuses == {"sent", "skipped_no_email"}


def test_send_batch_continues_on_failure(notif, monkeypatch):
    import smtplib
    from app import config
    monkeypatch.setattr(config, "EMAIL_ENABLED", True)
    monkeypatch.setattr(config, "SMTP_HOST", "smtp.test")
    monkeypatch.setattr(smtplib, "SMTP", _fake_smtp_class({}, raise_exc=RuntimeError("boom")))

    res = notif.send_notifications(RUN2, notif.default_template())   # both have valid emails
    assert res["counts"]["failed"] == 2 and res["counts"]["sent"] == 0
    assert all(it["error"] == "boom" for it in res["items"])
    assert {r["status"] for r in notif.list_notifications("run2")} == {"failed"}


def test_draft_mode_never_opens_smtp(notif, monkeypatch):
    import smtplib
    # EMAIL_ENABLED stays False (fixture). Any SMTP construction is a regression.
    def boom(*a, **k):
        raise AssertionError("draft mode must not open an SMTP connection")
    monkeypatch.setattr(smtplib, "SMTP", boom)
    monkeypatch.setattr(smtplib, "SMTP_SSL", boom)
    res = notif.send_notifications(RUN, notif.default_template())
    assert res["mode"] == "draft" and res["counts"]["drafted"] == 1


def test_delete_last_template_reseeds(notif):
    for t in notif.list_templates():
        notif.delete_template(t["id"])
    # default_template lazily re-seeds so notifications never break at runtime
    assert notif.default_template() is not None
    assert len(notif.list_templates()) == 1


def test_explicit_template_is_used(notif):
    custom = notif.create_template("Custom", "Hi {{candidate_name}} re {{job_title}}", "Body")
    previews = notif.build_previews(RUN, custom)
    assert previews[0]["subject"] == "Hi Alice re Site Engineer"


def test_resend_supersedes_not_accumulates(notif):
    t = notif.default_template()
    notif.send_notifications(RUN, t)
    notif.send_notifications(RUN, t)   # re-send
    assert len(notif.list_notifications("run1")) == 2   # not 4


def test_skipped_no_email_not_stored_with_garbage(notif):
    run = {"id": "rg", "jd_name": "X", "results": [
        {"filename": "g.pdf", "candidate_name": "Gail", "candidate_email": "n/a",
         "shortlisted": True, "overall_score": 60, "similarity": 0.5, "recommendation": "Good Match"}]}
    notif.send_notifications(run, notif.default_template())
    rec = notif.list_notifications("rg")[0]
    assert rec["status"] == "skipped_no_email" and rec["email"] == ""


def test_notification_routes_end_to_end(notif):
    from fastapi.testclient import TestClient
    from app import main
    rid = RUN["id"]  # RUNS key always equals the run's own id (as create_screening sets it)
    main.RUNS[rid] = RUN
    try:
        with TestClient(main.app) as c:
            send = c.post(f"/api/screenings/{rid}/notifications/send", json={}).json()
            assert send["mode"] == "draft"
            assert send["counts"]["drafted"] == 1 and send["counts"]["skipped_no_email"] == 1
            # persisted and readable on a separate request (per-call DB connection)
            listed = c.get(f"/api/screenings/{rid}/notifications").json()["notifications"]
            assert len(listed) == 2
            assert c.post("/api/screenings/nope/notifications/send", json={}).status_code == 404
    finally:
        main.RUNS.pop(rid, None)
