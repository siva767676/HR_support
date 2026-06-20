import asyncio

import httpx
import numpy as np

from . import config


async def embed_texts(texts: list[str]) -> np.ndarray:
    """Return L2-normalised float32 embeddings, one row per input text."""
    texts = [t[: config.MAX_DOC_CHARS] for t in texts]
    if config.EMBEDDING_PROVIDER == "local":
        vectors = _embed_local(texts)
    else:
        vectors = await _embed_openai_compatible(texts)
    vectors = np.asarray(vectors, dtype="float32")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


async def _embed_openai_compatible(texts: list[str]) -> list[list[float]]:
    headers = {}
    if config.EMBEDDING_API_KEY:
        headers["Authorization"] = f"Bearer {config.EMBEDDING_API_KEY}"

    batches = [texts[i : i + 32] for i in range(0, len(texts), 32)]

    async def _embed_batch(client: httpx.AsyncClient, batch: list[str]) -> list[list[float]]:
        resp = await client.post(
            f"{config.EMBEDDING_BASE_URL}/embeddings",
            headers=headers,
            json={"model": config.EMBEDDING_MODEL, "input": batch},
        )
        resp.raise_for_status()
        data = sorted(resp.json()["data"], key=lambda d: d["index"])
        return [d["embedding"] for d in data]

    async with httpx.AsyncClient(timeout=120) as client:
        # Run the 32-item batches concurrently; gather preserves batch order.
        results = await asyncio.gather(*(_embed_batch(client, b) for b in batches))

    return [vec for batch_vecs in results for vec in batch_vecs]


_local_model = None


def _embed_local(texts: list[str]):
    global _local_model
    if _local_model is None:
        from sentence_transformers import SentenceTransformer

        _local_model = SentenceTransformer(config.EMBEDDING_MODEL)
    return _local_model.encode(texts, show_progress_bar=False)
