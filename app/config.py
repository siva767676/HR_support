import os

from dotenv import load_dotenv

load_dotenv()


def _v1(url: str) -> str:
    url = url.rstrip("/")
    return url if url.endswith("/v1") else url + "/v1"


# Stage 2: LLM evaluation via the OpenAI-compatible endpoint on the GPU host
# (vLLM at 172.20.7.22:8000). The pinned docker subnet keeps this reachable
# from inside the container (see docker-compose.yml).
VLLM_BASE_URL = _v1(os.getenv("VLLM_BASE_URL", "http://172.20.7.22:8000/v1"))
VLLM_MODEL = os.getenv("VLLM_MODEL", "gemma4-31b")
# "EMPTY" for Ollama (which ignores auth); set it blank to omit the Authorization
# header entirely (see app.evaluator._auth_headers).
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "EMPTY")
# Sampling + transport knobs for the vLLM chat endpoint.
VLLM_TEMPERATURE = float(os.getenv("VLLM_TEMPERATURE", "0.3"))
VLLM_MAX_TOKENS = int(os.getenv("VLLM_MAX_TOKENS", "20000"))
VLLM_HTTP_TIMEOUT_S = int(os.getenv("VLLM_HTTP_TIMEOUT_S", "300"))

# Stage 1: embeddings — in-process sentence-transformers by default; setting
# EMBEDDING_BASE_URL switches to an OpenAI-compatible /v1/embeddings endpoint
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "")
EMBEDDING_PROVIDER = os.getenv(
    "EMBEDDING_PROVIDER", "openai_compatible" if EMBEDDING_BASE_URL else "local"
)
if EMBEDDING_BASE_URL:
    EMBEDDING_BASE_URL = _v1(EMBEDDING_BASE_URL)
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "")

# Fail fast on a provider/URL mismatch: an OpenAI-compatible provider with no
# base URL would silently POST to "/embeddings" and error cryptically at runtime.
if EMBEDDING_PROVIDER == "openai_compatible" and not EMBEDDING_BASE_URL:
    raise RuntimeError(
        "EMBEDDING_PROVIDER=openai_compatible requires EMBEDDING_BASE_URL to be set"
    )

TOP_K = int(os.getenv("TOP_K", "20"))
MAX_CONCURRENT_EVALS = int(os.getenv("MAX_CONCURRENT_EVALS", "12"))
MAX_DOC_CHARS = int(os.getenv("MAX_DOC_CHARS", "10000"))
# Larger budget for the one-time JD requirements extraction so that, when several
# JD files are uploaded and concatenated, later JDs aren't truncated away.
MAX_JD_CHARS = int(os.getenv("MAX_JD_CHARS", "20000"))
BATCH_EVAL_SIZE = int(os.getenv("BATCH_EVAL_SIZE", "4"))  # Resumes per batch

# Upload guards (multipart): friendly limits enforced before files are read into
# memory, instead of the opaque Starlette max_files=1000 ceiling.
MAX_RESUMES = int(os.getenv("MAX_RESUMES", "100"))
MAX_FILE_MB = int(os.getenv("MAX_FILE_MB", "10"))

# Cap retained in-memory runs so a long-lived server doesn't grow unbounded.
MAX_RETAINED_RUNS = int(os.getenv("MAX_RETAINED_RUNS", "50"))

# LLM evaluation resilience: starting output budget, the ceiling it may grow to
# when a response is truncated, and how many times to retry a failed evaluation
# (transient server error / timeout / unparseable JSON) before giving up.
MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", "3000"))
# Truncation-growth ceiling: defaults to VLLM_MAX_TOKENS (the canonical knob), but
# MAX_OUTPUT_TOKENS_CAP can still override it explicitly. The starting budget is
# clamped so it never exceeds the ceiling.
MAX_OUTPUT_TOKENS_CAP = int(os.getenv("MAX_OUTPUT_TOKENS_CAP", str(VLLM_MAX_TOKENS)))
MAX_OUTPUT_TOKENS = min(MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_CAP)
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))

# Final score = weighted sum of the LLM's 0-100 sub-scores
WEIGHTS = {
    "skills_match": 0.40,
    "experience_match": 0.30,
    "education_certifications": 0.10,
    "domain_relevance": 0.10,
    "projects_achievements": 0.10,
}

# --- Recruitment platform storage (JD repository, candidates, interviews) ---
# SQLite is the canonical store; finalized JDs are also mirrored to JD_EXPORT_DIR
# as Markdown files so the "JD repository" is portable/downloadable on disk.
DATA_DIR = os.getenv("DATA_DIR", "data")
DB_PATH = os.getenv("DB_PATH", os.path.join(DATA_DIR, "recruitment.db"))
JD_EXPORT_DIR = os.getenv("JD_EXPORT_DIR", os.path.join(DATA_DIR, "jds"))
# Shown in the standard JD template header.
COMPANY_NAME = os.getenv("COMPANY_NAME", "My Home Constructions (P) Ltd")
COMPANY_WEBSITE = os.getenv("COMPANY_WEBSITE", "www.myhomeconstructions.com")
# Logo embedded (top-right, every page) in DOCX JD exports. Defaults to the
# MY HOME GROUP lockup bundled with the package so it is baked into the Docker
# image; override with COMPANY_LOGO to use a different asset.
_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
COMPANY_LOGO = os.getenv(
    "COMPANY_LOGO", os.path.join(_PKG_DIR, "assets", "myhomegroup-logo.png")
)

# --- Email / shortlist notifications ---
# Draft mode by default: notifications are prepared and recorded but NO email is
# sent until an SMTP host is configured (EMAIL_ENABLED becomes true).
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER or "no-reply@myhomeconstructions.com")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")
# Implicit TLS (e.g. port 465) connects over SSL immediately; defaults on for 465.
SMTP_USE_SSL = os.getenv(
    "SMTP_USE_SSL", "true" if SMTP_PORT == 465 else "false"
).lower() in ("1", "true", "yes")
EMAIL_ENABLED = bool(SMTP_HOST)
