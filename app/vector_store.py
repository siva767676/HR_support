import faiss
import numpy as np


class VectorStore:
    """Flat inner-product index over L2-normalised vectors (= cosine similarity)."""

    def __init__(self, vectors: np.ndarray):
        self.index = faiss.IndexFlatIP(vectors.shape[1])
        self.index.add(vectors)

    def search(self, query: np.ndarray, k: int) -> list[tuple[int, float]]:
        k = min(k, self.index.ntotal)
        scores, indices = self.index.search(query.reshape(1, -1), k)
        return list(zip(indices[0].tolist(), scores[0].tolist()))
