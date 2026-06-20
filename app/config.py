import os

from dotenv import load_dotenv

load_dotenv()


def _v1(url: str) -> str:
    url = url.rstrip("/")
    return url if url.endswith("/v1") else url + "/v1"


# Stage 2: LLM evaluation via OpenAI-compatible vLLM server
VLLM_BASE_URL = _v1(os.getenv("VLLM_BASE_URL", "http://172.20.7.22:8000"))
VLLM_MODEL = os.getenv("VLLM_MODEL", "gemma4-31b")
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "not-needed")

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
MAX_OUTPUT_TOKENS_CAP = int(os.getenv("MAX_OUTPUT_TOKENS_CAP", "8000"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))

# Final score = weighted sum of the LLM's 0-100 sub-scores
WEIGHTS = {
    "skills_match": 0.40,
    "experience_match": 0.30,
    "education_certifications": 0.10,
    "domain_relevance": 0.10,
    "projects_achievements": 0.10,
}
