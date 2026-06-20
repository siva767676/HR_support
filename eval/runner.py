"""Run primitives for the benchmark — they drive the REAL pipeline modules
(`app.extraction`, `app.embeddings`, `app.vector_store`, `app.evaluator`,
`app.scoring`) so we measure exactly what production does. Raw outputs are
persisted to eval/results so metrics can be recomputed without re-calling the LLM."""

from __future__ import annotations

import json
import time
from pathlib import Path

from app import config, embeddings, evaluator, extraction, scoring
from app.vector_store import VectorStore

GOLDEN = Path(__file__).parent / "datasets" / "golden"
RESULTS = Path(__file__).parent / "results"
RAW = RESULTS / "raw"


# ----------------------------- loading -----------------------------

def load_golden() -> tuple[dict, dict, dict, dict]:
    """Return (labels, jd_texts, resume_texts, counterfactual_texts)."""
    labels = json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8"))
    jd_texts, resume_texts, cf_texts = {}, {}, {}
    for jid, info in labels["jds"].items():
        jd_texts[jid] = extraction.extract_text(jid + ".txt", (GOLDEN / info["file"]).read_bytes())
    for rid, info in labels["resumes"].items():
        resume_texts[rid] = extraction.extract_text(rid + ".txt", (GOLDEN / info["file"]).read_bytes())
    for pair in labels["counterfactual_pairs"]:
        for v in pair["variants"]:
            cf_texts[v["id"]] = extraction.extract_text(
                v["id"] + ".txt", (GOLDEN / v["file"]).read_bytes()
            )
    return labels, jd_texts, resume_texts, cf_texts


# ----------------------------- Stage 1 (local, no LLM) -----------------------------

async def stage1_rank(jd_text: str, resume_items: list[tuple[str, str]]) -> list[dict]:
    """Embed JD + resumes and return the full ranking: [{id, similarity}] desc."""
    ids = [rid for rid, _ in resume_items]
    texts = [t for _, t in resume_items]
    vectors = await embeddings.embed_texts([jd_text] + texts)
    store = VectorStore(vectors[1:])
    sim = dict(store.search(vectors[0], k=len(texts)))
    order = sorted(range(len(ids)), key=lambda i: sim.get(i, 0.0), reverse=True)
    return [{"id": ids[i], "similarity": round(float(sim.get(i, 0.0)), 4)} for i in order]


# ----------------------------- Stage 2 (LLM) -----------------------------

async def stage2_eval(jd_text: str, requirements: dict, resume_text: str) -> dict:
    """One LLM evaluation; returns the parsed scorecard + derived score/tier/latency.
    On failure, returns a record with error set (never raises)."""
    t0 = time.perf_counter()
    try:
        ev = await evaluator.evaluate_resume(jd_text, requirements, resume_text)
        dt = time.perf_counter() - t0
        score = scoring.overall_score(ev.get("scores", {}))
        return {
            "ok": True,
            "latency_s": round(dt, 2),
            "overall_score": score,
            "recommendation": scoring.recommendation(score),
            "scores": ev.get("scores", {}),
            "required_skills_matched": ev.get("required_skills_matched", []),
            "required_skills_missing": ev.get("required_skills_missing", []),
            "candidate_name": ev.get("candidate_name"),
            "years_experience_estimate": ev.get("years_experience_estimate"),
        }
    except Exception as exc:  # noqa: BLE001 - benchmark must record, not crash
        return {"ok": False, "latency_s": round(time.perf_counter() - t0, 2), "error": str(exc)}


# ----------------------------- persistence -----------------------------

def save_raw(name: str, obj) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{name}.json"
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")
    return path


def load_raw(name: str):
    path = RAW / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


# ----------------------------- connectivity probe -----------------------------

def llm_reachable(timeout: float = 5.0) -> tuple[bool, str]:
    """Quick check that the configured LLM host answers, without the long
    evaluator timeout/retries. Returns (ok, detail)."""
    import httpx

    url = f"{config.VLLM_BASE_URL}/models"
    headers = {"Authorization": f"Bearer {config.VLLM_API_KEY}"}
    try:
        resp = httpx.get(url, headers=headers, timeout=timeout)
        return (resp.status_code < 500, f"GET /models -> HTTP {resp.status_code}")
    except Exception as exc:  # noqa: BLE001
        return (False, f"{type(exc).__name__}: {exc}")
