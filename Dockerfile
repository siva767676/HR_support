FROM python:3.12-slim

WORKDIR /app

# CPU-only torch first: the default Linux wheel bundles CUDA libraries that
# are useless in this container and triple the image size
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# bake the embedding model into the image so the container needs no
# internet access (HuggingFace) at runtime
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY app ./app

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
