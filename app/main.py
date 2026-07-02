import asyncio
import hashlib
import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import (
    config,
    db,
    interview_service,
    jd_docx,
    jd_generator,
    jd_store,
    notifications,
    reporting,
    scoring,
    store,
)
from .embeddings import embed_texts
from .evaluator import (
    evaluate_resume,
    evaluate_resumes_batch,
    extract_jd_requirements,
)
from .extraction import extract_text
from .vector_store import VectorStore

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Initialize the DB schema and ensure a default email template exists.
    db.init_db()
    notifications.ensure_default_template()
    yield


app = FastAPI(title="AI Resume Screening & Scoring System", lifespan=_lifespan)

RUNS: dict[str, dict] = {}

# Cache of extracted JD requirements keyed by MD5 of the JD text.
# Avoids a ~40s LLM call when the same JD is screened multiple times.
_JD_REQUIREMENTS_CACHE: dict[str, dict] = {}

# Strong references to in-flight pipeline tasks. asyncio keeps only a weak ref to
# bare create_task() results, so without this a running screening can be GC'd
# mid-execution. (Kept separate from RUNS, which is JSON-serialized by the API.)
_background_tasks: set[asyncio.Task] = set()

_STATIC = Path(__file__).parent / "static"
_FRONTEND = Path(__file__).parent.parent / "frontend" / "dist"

SUPPORTED_EXTS = {".pdf", ".docx", ".txt", ".md"}


# The working screening UI (self-contained SPA). It lives at /app, where the new
# landing page's CTAs point, and at /legacy as an explicit alias during migration.
@app.get("/app")
@app.get("/legacy")
async def app_ui():
    return FileResponse(_STATIC / "index.html")


# Landing page at / once the Astro site is built; before that, fall back to the app
# so a fresh checkout without a frontend build still serves a working UI at /.
@app.get("/")
async def index():
    landing = _FRONTEND / "index.html"
    return FileResponse(
        landing if landing.exists() else _STATIC / "index.html",
        headers={"Cache-Control": "no-cache"},
    )


# ============================ JD repository / generator ============================

_JD_FIELDS = ("title", "location", "reporting", "experience", "skills",
              "responsibilities", "requirements")


def _jd_fields(payload: dict) -> dict:
    return {k: (payload.get(k) or "").strip() for k in _JD_FIELDS}


@app.post("/api/jds/generate")
async def generate_jd(payload: dict = Body(...)):
    """AI-generate a JD body (Markdown) from recruiter inputs. Not yet saved."""
    fields = _jd_fields(payload)
    if not fields["title"]:
        raise HTTPException(400, "A job title is required to generate a JD")
    try:
        body = await jd_generator.generate_jd(**fields)
        # Preview the finalized formatting too, so the UI can show what 'Save' will store.
        return {"body": body, "preview": jd_store.apply_template(fields, body)}
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the UI
        raise HTTPException(502, f"JD generation failed: {exc}")


@app.post("/api/jds/generate-skills")
async def generate_skills(payload: dict = Body(...)):
    """AI-generate required skills for a job role."""
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "A job title is required")
    try:
        skills = await jd_generator.generate_skills(title)
        return {"skills": skills}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Skill generation failed: {exc}")


@app.post("/api/jds/generate-responsibilities")
async def generate_responsibilities(payload: dict = Body(...)):
    """AI-generate key responsibilities for a job role."""
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "A job title is required")
    try:
        responsibilities = await jd_generator.generate_responsibilities(title)
        return {"responsibilities": responsibilities}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Responsibility generation failed: {exc}")


@app.get("/api/jds")
async def list_jds(search: str | None = None):
    return {"jds": jd_store.list_jds(search)}


@app.post("/api/jds")
async def create_jd(payload: dict = Body(...)):
    fields = _jd_fields(payload)
    if not fields["title"]:
        raise HTTPException(400, "A job title is required")
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "JD content is empty — generate or write a body first")
    return jd_store.create_jd(fields, body)


@app.get("/api/jds/{jd_id}")
async def get_jd(jd_id: int):
    record = jd_store.get_jd(jd_id)
    if not record:
        raise HTTPException(404, "JD not found")
    return record


@app.put("/api/jds/{jd_id}")
async def update_jd(jd_id: int, payload: dict = Body(...)):
    fields = _jd_fields(payload)
    # On edit the recruiter changes the finalized content directly (if provided).
    content = payload.get("content")
    record = jd_store.update_jd(jd_id, fields, content)
    if not record:
        raise HTTPException(404, "JD not found")
    return record


@app.delete("/api/jds/{jd_id}")
async def delete_jd(jd_id: int):
    if not jd_store.delete_jd(jd_id):
        raise HTTPException(404, "JD not found")
    return {"deleted": jd_id}


@app.get("/api/jds/{jd_id}/download")
async def download_jd(jd_id: int):
    record = jd_store.get_jd(jd_id)
    if not record:
        raise HTTPException(404, "JD not found")
    return PlainTextResponse(
        record["content"],
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{jd_store.download_name(record)}"'},
    )


@app.get("/api/jds/{jd_id}/download.docx")
async def download_jd_docx(jd_id: int):
    record = jd_store.get_jd(jd_id)
    if not record:
        raise HTTPException(404, "JD not found")
    fname = jd_store.download_name(record).rsplit(".", 1)[0] + ".docx"
    return Response(
        jd_docx.jd_docx_bytes(record),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@app.post("/api/screenings")
async def create_screening(
    top_k: int = Form(default=config.TOP_K),
    resumes: list[UploadFile] = File(...),
    jd_files: list[UploadFile] = File(default=[]),
    jd_id: int | None = Form(default=None),
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

    # JD source: a repository JD (by id) OR uploaded JD file(s).
    if jd_id is not None:
        record = jd_store.get_jd(jd_id)
        if not record:
            raise HTTPException(404, f"JD #{jd_id} not found in the repository")
        jd_sources = [(jd_store.download_name(record), record["content"].encode("utf-8"))]
        jd_name = record["title"]
    else:
        jd_sources = [(Path(u.filename or "").name, await u.read()) for u in _collect(jd_files)]
        if not jd_sources:
            raise HTTPException(400, "Upload a JD file or choose one from the repository")
        jd_name = ", ".join(name for name, _ in jd_sources)

    resume_sources = [(Path(u.filename or "").name, await u.read()) for u in _collect(resumes)]
    if not resume_sources:
        raise HTTPException(400, "The selected folder contains no PDF/DOCX/TXT resumes")

    run_id = uuid.uuid4().hex[:12]
    RUNS[run_id] = {
        "id": run_id,
        "status": "extracting",
        "jd_name": jd_name,
        "jd_id": jd_id,          # for forwarding shortlisted candidates to the interview
        "role": jd_name,         # role label used downstream; jd title for repo JDs
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
    ordered = sorted(
        run["results"],
        key=lambda r: (
            r["overall_score"] is not None,
            r["overall_score"] if r["overall_score"] is not None else 0,
            r["similarity"],
        ),
        reverse=True,
    )
    # resume_text is retained server-side for forwarding only — never sent to the live table.
    view["results"] = [{k: v for k, v in r.items() if k != "resume_text"} for r in ordered]
    return view


@app.get("/api/screenings/{run_id}/shortlist")
async def get_shortlist(run_id: str):
    """Shortlisted candidates of a completed run, for forwarding to the AI Interview.

    Reads the persisted run (survives the in-memory cap + restarts), falling back to
    the live RUNS dict. resume_text is intentionally omitted — interview/start looks
    it up server-side by run_id + candidate_key."""
    persisted = store.get_screening_run(run_id)
    run = persisted or RUNS.get(run_id)
    if run is None:
        raise HTTPException(404, "Unknown run id")
    done = store.completed_candidate_keys(run_id)
    candidates = []
    for r in run.get("results", []):
        if not r.get("shortlisted"):
            continue
        candidates.append({
            "candidate_key": r["filename"],
            "candidate_name": r.get("candidate_name") or r["filename"],
            "candidate_email": r.get("candidate_email"),
            "overall_score": r.get("overall_score"),
            "recommendation": r.get("recommendation"),
            "has_resume": bool((r.get("resume_text") or "").strip()),
            "interviewed": r["filename"] in done,
        })
    candidates.sort(key=lambda c: (c["overall_score"] is None, -(c["overall_score"] or 0)))
    return {
        "run_id": run_id,
        "jd_id": run.get("jd_id"),
        "jd_name": run.get("jd_name", ""),
        "role": run.get("role") or run.get("jd_name", ""),
        "jd_text": run.get("jd_text", ""),
        "candidates": candidates,
    }


@app.get("/api/screenings/{run_id}/report.xlsx")
async def download_shortlist_report(run_id: str):
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(404, "Unknown run id")
    return Response(
        reporting.shortlist_xlsx(run),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="shortlist-{run_id}.xlsx"'},
    )


# ============================ Email templates ============================

@app.get("/api/email-templates")
async def list_email_templates():
    notifications.ensure_default_template()  # always keep at least the default available
    return {"templates": notifications.list_templates(), "email_enabled": config.EMAIL_ENABLED}


@app.post("/api/email-templates")
async def create_email_template(payload: dict = Body(...)):
    if not (payload.get("subject") and payload.get("body")):
        raise HTTPException(400, "Template subject and body are required")
    return notifications.create_template(
        payload.get("name", ""), payload["subject"], payload["body"]
    )


@app.put("/api/email-templates/{tid}")
async def update_email_template(tid: int, payload: dict = Body(...)):
    rec = notifications.update_template(
        tid, payload.get("name", ""), payload.get("subject", ""), payload.get("body", "")
    )
    if not rec:
        raise HTTPException(404, "Template not found")
    return rec


@app.delete("/api/email-templates/{tid}")
async def delete_email_template(tid: int):
    if not notifications.delete_template(tid):
        raise HTTPException(404, "Template not found")
    return {"deleted": tid}


# ============================ Shortlist notifications ============================

def _run_or_404(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(404, "Unknown run id")
    return run


def _template_or_400(template_id) -> dict:
    # Fall back to the default if the id is missing OR stale/deleted.
    t = (notifications.get_template(template_id) if template_id else None) or notifications.default_template()
    if not t:
        raise HTTPException(400, "No email template available")
    return t


@app.post("/api/screenings/{run_id}/notifications/preview")
async def preview_notifications(run_id: str, payload: dict = Body(default={})):
    run = _run_or_404(run_id)
    template = _template_or_400(payload.get("template_id"))
    return {"template": template, "previews": notifications.build_previews(run, template)}


@app.post("/api/screenings/{run_id}/notifications/send")
async def send_shortlist_notifications(run_id: str, payload: dict = Body(default={})):
    run = _run_or_404(run_id)
    template = _template_or_400(payload.get("template_id"))
    return notifications.send_notifications(run, template)


@app.get("/api/screenings/{run_id}/notifications")
async def list_run_notifications(run_id: str):
    return {"notifications": notifications.list_notifications(run_id)}


# ============================ AI interview ============================

@app.post("/api/interview/start")
async def interview_start(payload: dict = Body(...)):
    """Plan a tailored interview from a role + JD + resume text; return question 1.

    Two modes:
    - Manual: role + job_description + resume_text supplied directly.
    - From screening: run_id + candidate_key supplied; role/JD/resume are resolved
      server-side from the persisted screening run (no re-upload needed).

    A completed interview is persisted (Dashboard); the in-memory thread itself is
    valid only until the process restarts (then submit_answer raises 409).
    """
    run_id = (payload.get("run_id") or "").strip() or None
    candidate_key = (payload.get("candidate_key") or "").strip() or None
    role = (payload.get("role") or "").strip()
    jd = (payload.get("job_description") or "").strip()
    resume = (payload.get("resume_text") or "").strip()
    name = (payload.get("candidate_name") or "Candidate").strip()
    email = (payload.get("candidate_email") or "").strip() or None

    # Resolve role/JD/resume from the persisted screening run when forwarding.
    if run_id and candidate_key:
        srun = store.get_screening_run(run_id)
        if not srun:
            raise HTTPException(404, "Screening run not found")
        cand = next((r for r in srun.get("results", []) if r.get("filename") == candidate_key), None)
        if not cand:
            raise HTTPException(404, "Candidate not found in that screening run")
        role = role or srun.get("role") or srun.get("jd_name", "")
        jd = jd or srun.get("jd_text", "")
        resume = resume or (cand.get("resume_text") or "")
        name = (payload.get("candidate_name") or cand.get("candidate_name") or candidate_key).strip()
        email = email or cand.get("candidate_email")

    if not role:
        raise HTTPException(400, "A role is required to start an interview")
    if not jd:
        raise HTTPException(400, "A job description is required to start an interview")
    if not resume:
        raise HTTPException(400, "Candidate resume text is required to start an interview")
    try:
        result = await interview_service.start_interview(
            candidate_name=name,
            role=role,
            experience_level=(payload.get("experience_level") or "mid").strip(),
            resume_text=resume,
            job_description=jd,
            assessment_summary=(payload.get("assessment_summary") or "").strip(),
            max_questions=payload.get("max_questions", 5),
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the UI
        raise HTTPException(502, f"Could not start interview: {exc}")

    # Record the interview for the Dashboard (never let a DB error fail the start).
    try:
        iid = store.create_interview(
            run_id=run_id, candidate_key=candidate_key,
            candidate_name=name, candidate_email=email, role=role,
        )
        store.attach_thread(iid, result["thread_id"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not record interview start: %s", exc)

    return {**result, "role": role, "candidate_name": name}


@app.post("/api/extract")
async def extract_document(file: UploadFile = File(...)):
    """Extract plain text from one uploaded document (PDF, DOCX, TXT, MD).

    Used by the interview module so a recruiter can upload a resume instead of
    pasting text. Nothing is stored: the extracted text is returned to the caller.
    """
    name = Path(file.filename or "").name
    if Path(name).suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(400, "Unsupported file type. Upload a PDF, DOCX, TXT, or MD file.")
    data = await file.read()
    if len(data) > config.MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(413, f"File exceeds the {config.MAX_FILE_MB} MB limit")
    try:
        text = await asyncio.to_thread(extract_text, name, data)
    except ValueError as exc:
        raise HTTPException(422, f"Could not read {name}: {exc}")
    return {"filename": name, "text": text, "chars": len(text)}


@app.post("/api/interview/transcribe")
async def interview_transcribe(audio: UploadFile = File(...)):
    """Transcribe an audio blob to text using server-side faster-whisper.

    Accepts any audio format MediaRecorder can produce (webm/opus, ogg, wav).
    Returns {"text": "..."}. Responds 503 if faster-whisper is not installed.
    """
    from . import speech as _speech  # lazy: startup unaffected when not installed

    data = await audio.read()
    if not data:
        raise HTTPException(400, "Empty audio file")
    try:
        text = await asyncio.to_thread(_speech.transcribe_audio, data)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Transcription failed: {exc}")
    return {"text": text}


@app.post("/api/interview/answer")
async def interview_answer(payload: dict = Body(...)):
    """Score the current answer and return the next question or the final report."""
    thread_id = (payload.get("thread_id") or "").strip()
    if not thread_id:
        raise HTTPException(400, "thread_id is required")
    try:
        result = await interview_service.submit_answer(thread_id, payload.get("answer") or "")
    except interview_service.InterviewExpired:
        try:
            store.expire_interview(thread_id)
        except Exception:  # noqa: BLE001
            pass
        raise HTTPException(
            409, "This interview session has expired. Please start a new interview."
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the UI
        raise HTTPException(502, f"Could not process answer: {exc}")

    # Persist the final report when the interview finishes (for the Dashboard).
    if result.get("done") and result.get("report"):
        try:
            store.complete_interview(thread_id, result["report"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not persist interview report: %s", exc)
    return result


# ============================ Dashboard ============================

@app.get("/api/screening-runs")
async def list_screening_runs(limit: int = 50):
    """Persisted screening-run summaries for the Dashboard."""
    return {"runs": store.list_screening_runs(limit)}


@app.get("/api/interviews")
async def list_interviews(limit: int = 100):
    """Persisted interview outcomes for the Dashboard."""
    return {"interviews": store.list_interviews(limit)}


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

        # Stage 1: parse the JD into structured requirements first — the rest of the
        # pipeline (shortlist + scoring) is matched against these. Cached by JD
        # content hash so repeated runs skip this ~40s LLM call.
        run["status"] = "extracting_requirements"
        jd_hash = hashlib.md5(jd_text.encode()).hexdigest()
        if jd_hash not in _JD_REQUIREMENTS_CACHE:
            _JD_REQUIREMENTS_CACHE[jd_hash] = await extract_jd_requirements(jd_text)
        requirements = _JD_REQUIREMENTS_CACHE[jd_hash]
        run["jd_requirements"] = requirements

        # Stage 2: embed JD + resumes, shortlist the closest matches by cosine
        # similarity so only the strongest candidates go to in-depth LLM scoring.
        run["status"] = "embedding"
        vectors = await embed_texts([jd_text] + [f["text"] for f in files])
        vstore = VectorStore(vectors[1:])
        similarity = dict(vstore.search(vectors[0], k=len(files)))

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
                # Retained for forwarding to the interview (shortlisted only, clipped);
                # stripped from the live polling response in get_screening.
                "resume_text": f["text"][: config.MAX_DOC_CHARS] if i in shortlist else None,
            })

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
                                "candidate_email": ev.get("candidate_email"),
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
                                "education": ev.get("education", []),
                                "experience": ev.get("experience", []),
                                "projects": ev.get("projects", []),
                                "certifications": ev.get("certifications", []),
                                "achievements": ev.get("achievements", []),
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
        # Persist the completed run (with shortlisted resume_text) so the Dashboard and
        # the screening->interview hand-off survive the in-memory cap and restarts.
        # A DB failure must never flip a successful run to error.
        try:
            store.save_screening_run(run, run.get("jd_id"), run.get("role", ""), jd_text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not persist screening run %s: %s", run_id, exc)
    except Exception as exc:
        run["status"] = "error"
        run["error"] = str(exc)


# Serve the built landing page's static assets (/_astro/*, /favicon.*). Mounted last,
# after every API and page route, so those always win; this only catches asset paths.
# Skipped when the frontend has not been built so startup never fails on a fresh clone.
class _CachingStaticFiles(StaticFiles):
    """Static serving with correct cache headers. Astro fingerprints every asset
    under /_astro/ with a content hash, so those are immutable and safe to cache
    for a year. HTML pages are NOT hashed, so they must revalidate on every load;
    otherwise a redeploy (which changes asset hashes) leaves browsers on stale HTML
    pointing at a deleted CSS/JS file, rendering the page completely unstyled."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            if path.startswith("_astro/"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "no-cache"
        return response


if _FRONTEND.exists():
    app.mount("/", _CachingStaticFiles(directory=_FRONTEND, html=True), name="frontend")
