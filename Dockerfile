# ── Stage 1: build Astro landing page ─────────────────────────────────────────
FROM node:22-slim AS frontend-build

WORKDIR /build

# Enable pnpm via corepack (ships with Node 22)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifests first — layer cache is reused unless package.json / lock file changes
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

# Copy rest of source and build
COPY frontend/ ./
RUN pnpm build
# Output: /build/dist


# ── Stage 2: Python API server ─────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# CPU-only torch — avoids the CUDA wheel that triples image size
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Bake the embedding model so the container needs no internet at runtime
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Copy the FastAPI application
COPY app ./app

# Copy the built landing from stage 1
# app/main.py resolves _FRONTEND as Path(__file__).parent.parent / "frontend" / "dist"
# = /app/frontend/dist inside this container
COPY --from=frontend-build /build/dist ./frontend/dist

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
