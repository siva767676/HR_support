"""Pure metric functions for the benchmark. numpy-only (no scipy/sklearn dep) so
they are trivially unit-testable against hand-computed fixtures."""

from __future__ import annotations

import math

import numpy as np


# ----------------------------- ranking / retrieval -----------------------------

def recall_at_k(ranked_ids: list, relevant_ids, k: int) -> float:
    """Fraction of the relevant items that appear in the top-k of a ranking."""
    relevant = set(relevant_ids)
    if not relevant:
        return float("nan")
    topk = set(ranked_ids[:k])
    return len(topk & relevant) / len(relevant)


def precision_at_k(ranked_ids: list, relevant_ids, k: int) -> float:
    """Fraction of the top-k that are relevant."""
    if k <= 0:
        return float("nan")
    relevant = set(relevant_ids)
    topk = ranked_ids[:k]
    return sum(1 for i in topk if i in relevant) / min(k, len(topk)) if topk else 0.0


def dcg_at_k(ranked_ids: list, relevance: dict, k: int) -> float:
    """Discounted cumulative gain with graded relevance (0 for unlabelled ids)."""
    total = 0.0
    for rank, item in enumerate(ranked_ids[:k], start=1):
        rel = relevance.get(item, 0)
        total += rel / math.log2(rank + 1)
    return total


def ndcg_at_k(ranked_ids: list, relevance: dict, k: int) -> float:
    """DCG normalised by the ideal DCG. 1.0 == perfect ordering."""
    ideal_order = sorted(relevance, key=lambda i: relevance[i], reverse=True)
    idcg = dcg_at_k(ideal_order, relevance, k)
    if idcg == 0:
        return float("nan")
    return dcg_at_k(ranked_ids, relevance, k) / idcg


def rank_of(ranked_ids: list, item) -> int | None:
    """1-based position of item in the ranking, or None if absent."""
    for i, x in enumerate(ranked_ids, start=1):
        if x == item:
            return i
    return None


# ----------------------------- rank correlation -----------------------------

def _ranks(values: list[float]) -> np.ndarray:
    """Average ranks (1-based), ties shared — the standard fractional ranking."""
    a = np.asarray(values, dtype=float)
    order = a.argsort()
    ranks = np.empty(len(a), dtype=float)
    ranks[order] = np.arange(1, len(a) + 1, dtype=float)
    # average tied ranks
    _, inv, counts = np.unique(a, return_inverse=True, return_counts=True)
    sums = np.zeros(len(counts))
    np.add.at(sums, inv, ranks)
    avg = sums / counts
    return avg[inv]


def spearman(xs: list[float], ys: list[float]) -> float:
    """Spearman rank correlation = Pearson on ranks. NaN if undefined."""
    if len(xs) != len(ys) or len(xs) < 2:
        return float("nan")
    rx, ry = _ranks(xs), _ranks(ys)
    if rx.std() == 0 or ry.std() == 0:
        return float("nan")
    return float(np.corrcoef(rx, ry)[0, 1])


def kendall_tau(xs: list[float], ys: list[float]) -> float:
    """Kendall tau-a (no tie correction; adequate for our small sets)."""
    n = len(xs)
    if n != len(ys) or n < 2:
        return float("nan")
    concordant = discordant = 0
    for i in range(n):
        for j in range(i + 1, n):
            sx = np.sign(xs[i] - xs[j])
            sy = np.sign(ys[i] - ys[j])
            prod = sx * sy
            if prod > 0:
                concordant += 1
            elif prod < 0:
                discordant += 1
    denom = n * (n - 1) / 2
    return (concordant - discordant) / denom if denom else float("nan")


# ----------------------------- classification / tiers -----------------------------

def tier_confusion(pred: list[str], true: list[str], labels: list[str]) -> dict:
    """Confusion matrix + accuracy for the Strong/Good/Weak tiers."""
    idx = {lab: i for i, lab in enumerate(labels)}
    m = [[0] * len(labels) for _ in labels]
    correct = 0
    for p, t in zip(pred, true):
        if p in idx and t in idx:
            m[idx[t]][idx[p]] += 1
            if p == t:
                correct += 1
    total = sum(sum(row) for row in m)
    return {
        "labels": labels,
        "matrix": m,  # matrix[true][pred]
        "accuracy": correct / total if total else float("nan"),
        "n": total,
    }


# ----------------------------- skills -----------------------------

def skill_pr(predicted: list[str], planted: list[str]) -> dict:
    """Precision / recall / F1 of matched skills vs the planted skill manifest.
    Case-insensitive exact match on trimmed strings."""
    norm = lambda xs: {s.strip().lower() for s in xs if s and s.strip()}
    pred, gold = norm(predicted), norm(planted)
    if not pred and not gold:
        return {"precision": 1.0, "recall": 1.0, "f1": 1.0}
    tp = len(pred & gold)
    precision = tp / len(pred) if pred else 0.0
    recall = tp / len(gold) if gold else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


# ----------------------------- consistency / variance -----------------------------

def variance_stats(scores: list[float]) -> dict:
    """Spread of repeated scores for the same input."""
    a = np.asarray([s for s in scores if s is not None], dtype=float)
    if a.size == 0:
        return {"n": 0, "mean": float("nan"), "std": float("nan"), "range": float("nan")}
    return {
        "n": int(a.size),
        "mean": float(a.mean()),
        "std": float(a.std(ddof=0)),
        "range": float(a.max() - a.min()),
    }


def flip_rate(tiers_per_run: list[list[str]]) -> float:
    """Fraction of items whose tier was not identical across all repeats.
    Input: list over runs, each a list of tiers aligned by item."""
    if not tiers_per_run or len(tiers_per_run) < 2:
        return float("nan")
    n_items = len(tiers_per_run[0])
    flips = 0
    for i in range(n_items):
        seen = {run[i] for run in tiers_per_run}
        if len(seen) > 1:
            flips += 1
    return flips / n_items if n_items else float("nan")


# ----------------------------- fairness -----------------------------

def bias_deltas(pairs: list[tuple[float, float]]) -> dict:
    """Given (baseline_score, counterfactual_score) pairs that should be equal,
    summarise the deltas. Systematic direction = mean far from 0."""
    deltas = [b - a for a, b in pairs if a is not None and b is not None]
    if not deltas:
        return {"n": 0, "mean_delta": float("nan"), "max_abs": float("nan")}
    arr = np.asarray(deltas, dtype=float)
    return {
        "n": int(arr.size),
        "mean_delta": float(arr.mean()),
        "max_abs": float(np.abs(arr).max()),
        "std": float(arr.std(ddof=0)),
    }
