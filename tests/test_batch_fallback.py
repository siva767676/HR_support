"""Covers M1/H2: a failed or mismatched batch must fall back to per-resume
evaluation and always return a list the same length as the input (None = failed),
so unrelated candidates aren't doomed and none are left stranded."""

from app import evaluator

RESUMES = [("a.pdf", "A"), ("b.pdf", "B"), ("c.pdf", "C")]


async def test_falls_back_when_batch_call_raises(monkeypatch):
    async def boom(_prompt):
        raise ValueError("garbled array")

    async def fake_eval(_jd, _req, text):
        return {"candidate_name": text}

    monkeypatch.setattr(evaluator, "_chat_json_array", boom)
    monkeypatch.setattr(evaluator, "evaluate_resume", fake_eval)

    out = await evaluator.evaluate_resumes_batch("jd", {}, RESUMES)
    assert [r["candidate_name"] for r in out] == ["A", "B", "C"]


async def test_falls_back_on_count_mismatch(monkeypatch):
    async def short(_prompt):
        return [{"candidate_name": "only one"}]  # 1 result for 3 resumes

    async def fake_eval(_jd, _req, text):
        return {"candidate_name": text}

    monkeypatch.setattr(evaluator, "_chat_json_array", short)
    monkeypatch.setattr(evaluator, "evaluate_resume", fake_eval)

    out = await evaluator.evaluate_resumes_batch("jd", {}, RESUMES)
    assert len(out) == 3
    assert [r["candidate_name"] for r in out] == ["A", "B", "C"]


async def test_success_returns_array_without_fallback(monkeypatch):
    async def good(_prompt):
        return [{"candidate_name": n} for n in ("A", "B", "C")]

    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("fallback should not be used when the batch succeeds")

    monkeypatch.setattr(evaluator, "_chat_json_array", good)
    monkeypatch.setattr(evaluator, "evaluate_resume", must_not_run)

    out = await evaluator.evaluate_resumes_batch("jd", {}, RESUMES)
    assert [r["candidate_name"] for r in out] == ["A", "B", "C"]


async def test_fallback_preserves_length_with_none_for_failures(monkeypatch):
    async def boom(_prompt):
        raise ValueError("garbled array")

    async def flaky_eval(_jd, _req, text):
        if text == "B":
            raise RuntimeError("model failed on B")
        return {"candidate_name": text}

    monkeypatch.setattr(evaluator, "_chat_json_array", boom)
    monkeypatch.setattr(evaluator, "evaluate_resume", flaky_eval)

    out = await evaluator.evaluate_resumes_batch("jd", {}, RESUMES)
    assert len(out) == 3
    assert out[0]["candidate_name"] == "A"
    assert out[1] is None  # failed item is None, not dropped — keeps alignment
    assert out[2]["candidate_name"] == "C"
