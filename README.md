# Resume Screener — Two-Stage Semantic Matching

AI-powered bulk resume screening: an embedding-based similarity shortlist (Stage 1)
followed by a deep LLM evaluation (Stage 2) running on your own OpenAI-compatible
GPU host (vLLM, Ollama, …).

```
Upload resumes + JD → Text Extraction → Embeddings → FAISS Similarity Search
     → Top-K Shortlist → LLM Evaluation → Weighted Scoring & Ranking → Dashboard
```

Open the web app, **upload a folder of resumes and one or more Job Description
files** from your device, set the shortlist size, and click **Analyze**. Every
resume is ranked by match score; the shortlist (top-K) gets a full LLM scorecard.
Nothing is persisted — each screening is a standalone, in-memory analysis.

## Scoring model

The LLM returns 0–100 sub-scores which are combined into a weighted overall score:

| Dimension                  | Weight |
|----------------------------|--------|
| Skills match               | 40%    |
| Experience match           | 30%    |
| Education / certifications | 10%    |
| Domain relevance           | 10%    |
| Projects / achievements    | 10%    |

Recommendation: **Strong Match** ≥ 75, **Good Match** ≥ 55, otherwise **Weak Match**.
Each candidate also gets strengths, missing requirements, matched/missing skills,
an experience estimate, and a one-line summary.

## Setup

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # then edit .env
```

## Configuration (`.env`)

| Variable | Purpose | Default |
|---|---|---|
| `VLLM_BASE_URL` | OpenAI-compatible LLM server (vLLM, Ollama, ...) | `http://172.20.7.22:8000` |
| `VLLM_MODEL` | Model name as served (e.g. Ollama: `gemma4:31b`) | `gemma4-31b` |
| `VLLM_API_KEY` | API key for the LLM server (if required) | `not-needed` |
| `EMBEDDING_MODEL` | Embedding model name | `all-MiniLM-L6-v2` |
| `EMBEDDING_BASE_URL` | Optional: OpenAI-compatible `/v1/embeddings` endpoint | — (in-process) |
| `EMBEDDING_API_KEY` | API key for the embedding endpoint (if needed) | — |
| `TOP_K` | How many shortlisted resumes get full LLM evaluation | `20` |
| `MAX_CONCURRENT_EVALS` | Parallel LLM evaluation calls | `12` |
| `BATCH_EVAL_SIZE` | Resumes scored per LLM call (falls back to 1-per-call on failure) | `4` |
| `MAX_DOC_CHARS` | Truncation limit for each resume/JD sent to the models | `10000` |
| `MAX_JD_CHARS` | Truncation limit for the (possibly multi-file) JD during requirements extraction | `20000` |
| `MAX_RESUMES` | Max resumes accepted per screening (friendly 413 above this) | `100` |
| `MAX_FILE_MB` | Per-file size cap; larger files are skipped and reported | `10` |
| `MAX_RETAINED_RUNS` | In-memory runs kept before the oldest is evicted | `50` |

Embeddings run **in-process** with sentence-transformers by default — fully
on-prem, no resume text leaves the machine. Setting `EMBEDDING_BASE_URL`
switches to a remote OpenAI-compatible endpoint (a self-hosted embedding
server, or OpenAI cloud with e.g. `EMBEDDING_MODEL=text-embedding-3-large`).

> Note: the GPU host `172.20.7.22` serves the model via **Ollama** on port
> `11434` (`gemma4:31b`) — Ollama's OpenAI-compatible API works directly as
> `VLLM_BASE_URL`. Port 8000 on that host is an unrelated app.

## Run

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Open <http://localhost:8080>, choose a resume folder and JD file(s), set the
top-K shortlist size, click **Analyze**, and watch results rank live as
evaluations complete. The **Shortlisted Candidates** and **Dashboard** pages
update automatically.

## Run with Docker

```powershell
copy .env.example .env   # set your LLM/embedding endpoints first
docker compose up --build
```

The container serves the web app on port 8080; resumes and JDs are uploaded
through the browser, so no host folder needs to be mounted. The embedding model
is baked into the image (see [Dockerfile](Dockerfile)), so the container needs
no internet access at runtime — only network reachability to your LLM host.

Or without compose:

```powershell
docker build -t resume-screener .
docker run -p 8080:8080 --env-file .env resume-screener
```

> [docker-compose.yml](docker-compose.yml) pins a custom subnet because Docker's
> default pool can hand out `172.20.0.0/16`, which would shadow the GPU host's
> LAN address (`172.20.7.22`) and make it unreachable from inside the container.

## API

- `GET /` — the single-page web app.
- `POST /api/screenings` — `multipart/form-data` with repeated `resumes` file
  parts, repeated `jd_files` file parts, and a `top_k` field. Returns
  `{ "run_id": ..., "total": ... }` and processes in the background.
- `GET /api/screenings/{run_id}` — status, progress, and ranked results.

Uploads are limited to `MAX_RESUMES` files per request (default 100) and
`MAX_FILE_MB` per file (default 10 MB); oversized files are skipped and listed
in the run's `file_errors`.

## Notes

- Vector store is FAISS (`IndexFlatIP` over normalised vectors = cosine
  similarity) — in-process, no server to run. Swap `app/vector_store.py` for
  ChromaDB/Pinecone if you later need persistence across runs.
- Results are kept in memory per run (capped at `MAX_RETAINED_RUNS`); a restart
  clears them. There is no authentication — run it on a trusted network only.
- Resumes/JDs are truncated to `MAX_DOC_CHARS` before being sent to the models;
  raise it if your LLM context window allows.

## Tests

```powershell
pytest -q
```

Covers the weighted scoring, the best-effort JSON repair (single + array), and
the batch→per-resume evaluation fallback.
