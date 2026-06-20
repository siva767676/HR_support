import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import config, scoring
from .embeddings import embed_texts
from .evaluator import (
    evaluate_resume,
    evaluate_resumes_batch,
    extract_jd_requirements,
)
from .extraction import extract_text
from .vector_store import VectorStore

app = FastAPI(title="AI Resume Screening & Scoring System")

logger = logging.getLogger(__name__)

RUNS: dict[str, dict] = {}

# Strong references to in-flight pipeline tasks. asyncio keeps only a weak ref to
# bare create_task() results, so without this a running screening can be GC'd
# mid-execution. (Kept separate from RUNS, which is JSON-serialized by the API.)
_background_tasks: set[asyncio.Task] = set()

_STATIC = Path(__file__).parent / "static"

SUPPORTED_EXTS = {".pdf", ".docx", ".txt", ".md"}


@app.get("/")
async def index():
    return FileResponse(_STATIC / "index.html")


@app.post("/api/screenings")
async def create_screening(
    top_k: int = Form(default=config.TOP_K),
    resumes: list[UploadFile] = File(...),
    jd_files: list[UploadFile] = File(...),
):
    # Guard: cap the resume count up front, before reading anything into memory.
    if len(resumes) > config.MAX_RESUMES:
        raise HTTPException(
            413,
            f"Too many resumes: {len(resumes)} (max {config.MAX_RESUMES}). "
            "Please screen in smaller batches.",
        )

    max_bytes = config.MAX_FILE_MB * 1024 * 1024
    upload_errors: list[dict] = []

    def _collect(uploads):
        """Read supported, in-size-limit uploads; record skipped files."""
        sources = []
        for upload in uploads:
            name = Path(upload.filename or "").name
            if Path(name).suffix.lower() not in SUPPORTED_EXTS:
                continue
            if upload.size and upload.size > max_bytes:
                upload_errors.append(
                    {"filename": name, "error": f"exceeds {config.MAX_FILE_MB} MB limit"}
                )
                continue
            sources.append(upload)
        return sources

    # JD sources come from files uploaded by the user
    jd_sources = [(Path(u.filename or "").name, await u.read()) for u in _collect(jd_files)]
    if not jd_sources:
        raise HTTPException(400, "No valid JD files uploaded")
    jd_name = ", ".join(name for name, _ in jd_sources)

    resume_sources = [(Path(u.filename or "").name, await u.read()) for u in _collect(resumes)]
    if not resume_sources:
        raise HTTPException(400, "The selected folder contains no PDF/DOCX/TXT resumes")

    run_id = uuid.uuid4().hex[:12]
    RUNS[run_id] = {
        "id": run_id,
        "status": "extracting",
        "jd_name": jd_name,
        "total": len(resume_sources),
        "shortlisted": 0,
        "evaluated": 0,
        "file_errors": list(upload_errors),
        "results": [],
    }
    # Bound retained runs so a long-lived server doesn't leak memory run-by-run.
    while len(RUNS) > config.MAX_RETAINED_RUNS:
        RUNS.pop(next(iter(RUNS)))

    task = asyncio.create_task(
        _run_pipeline(run_id, jd_sources, resume_sources, max(1, top_k), upload_errors)
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return {"run_id": run_id, "total": len(resume_sources)}


@app.get("/api/screenings/{run_id}")
async def get_screening(run_id: str):
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(404, "Unknown run id")
    view = dict(run)
    view["results"] = sorted(
        run["results"],
        key=lambda r: (
            r["overall_score"] is not None,
            r["overall_score"] if r["overall_score"] is not None else 0,
            r["similarity"],
        ),
        reverse=True,
    )
    return view


async def _run_pipeline(
    run_id: str,
    jd_sources: list[tuple[str, bytes]],
    resume_sources: list[tuple[str, bytes]],
    top_k: int,
    upload_errors: list[dict] | None = None,
):
    run = RUNS[run_id]
    try:
        # Stage 0: extract text off the event loop (dozens of PDFs take a while)
        def read_all():
            jd_parts, files, errors = [], [], []
            for name, data in jd_sources:
                try:
                    jd_parts.append(extract_text(name, data))
                except ValueError as exc:
                    errors.append({"filename": name, "error": str(exc)})
            for name, data in resume_sources:
                try:
                    files.append({"filename": name, "text": extract_text(name, data)})
                except ValueError as exc:
                    errors.append({"filename": name, "error": str(exc)})
            return jd_parts, files, errors

        jd_parts, files, errors = await asyncio.to_thread(read_all)
        run["file_errors"] = (upload_errors or []) + errors
        run["total"] = len(files)
        if not jd_parts:
            raise ValueError("No readable job description file")
        if not files:
            raise ValueError("No readable resumes in the selected folder")
        jd_text = "\n\n---\n\n".join(jd_parts)

        # Stage 1: embed JD + resumes, shortlist by cosine similarity
        run["status"] = "embedding"
        vectors = await embed_texts([jd_text] + [f["text"] for f in files])
        store = VectorStore(vectors[1:])
        similarity = dict(store.search(vectors[0], k=len(files)))

        order = sorted(range(len(files)), key=lambda i: similarity.get(i, 0.0), reverse=True)
        shortlist = set(order[:top_k])
        run["shortlisted"] = len(shortlist)

        for i, f in enumerate(files):
            run["results"].append({
                "filename": f["filename"],
                "candidate_name": f["filename"],
                "similarity": round(float(similarity.get(i, 0.0)), 4),
                "shortlisted": i in shortlist,
                "overall_score": None,
                "recommendation": None if i in shortlist else "Not shortlisted",
            })

        # Stage 2: extract JD requirements once, then LLM-evaluate the shortlist
        run["status"] = "extracting_requirements"
        requirements = await extract_jd_requirements(jd_text)
        run["jd_requirements"] = requirements

        run["status"] = "evaluating"
        semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_EVALS)
        shortlist_indices = sorted(shortlist)

        # Batch evaluations for better throughput
        async def evaluate_batch(batch_indices: list[int]):
            async with semaphore:
                try:
                    batch_resumes = [
                        (files[i]["filename"], files[i]["text"]) for i in batch_indices
                    ]
                    evaluations = await evaluate_resumes_batch(
                        jd_text, requirements, batch_resumes
                    )
                    # Reconcile every candidate in the batch — iterate by position so
                    # a short/missing evaluation can't silently strand a row on
                    # "Evaluating…" (it gets marked failed instead).
                    for pos, batch_idx in enumerate(batch_indices):
                        result = run["results"][batch_idx]
                        ev = evaluations[pos] if pos < len(evaluations) else None
                        if ev:
                            score = scoring.overall_score(ev.get("scores", {}))
                            result.update({
                                "candidate_name": ev.get("candidate_name")
                                or result["filename"],
                                "overall_score": score,
                                "recommendation": scoring.recommendation(score),
                                "scores": ev.get("scores", {}),
                                "strengths": ev.get("strengths", []),
                                "missing_requirements": ev.get("missing_requirements", []),
                                "required_skills_matched": ev.get(
                                    "required_skills_matched", []
                                ),
                                "required_skills_missing": ev.get(
                                    "required_skills_missing", []
                                ),
                                "preferred_skills_matched": ev.get(
                                    "preferred_skills_matched", []
                                ),
                                "years_experience_estimate": ev.get(
                                    "years_experience_estimate"
                                ),
                                "summary": ev.get("summary", ""),
                            })
                        else:
                            result["recommendation"] = "Evaluation failed"
                            result["error"] = "No evaluation returned (batch result mismatch)"
                        run["evaluated"] += 1
                except Exception as exc:
                    for batch_idx in batch_indices:
                        result = run["results"][batch_idx]
                        result["recommendation"] = "Evaluation failed"
                        result["error"] = str(exc)
                        run["evaluated"] += 1
                    logger.warning("Batch evaluation failed: %s", exc)

        # Create batches and evaluate
        batch_size = config.BATCH_EVAL_SIZE
        batches = [
            shortlist_indices[i : i + batch_size]
            for i in range(0, len(shortlist_indices), batch_size)
        ]
        await asyncio.gather(*(evaluate_batch(batch) for batch in batches))
        run["status"] = "complete"
    except Exception as exc:
        run["status"] = "error"
        run["error"] = str(exc)
