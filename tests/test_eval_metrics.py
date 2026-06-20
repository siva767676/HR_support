"""Unit tests for the benchmark metrics, checked against hand-computed values."""

import math

from eval import metrics


def test_recall_at_k():
    ranked = ["a", "b", "c", "d", "e"]
    relevant = {"a", "c", "x"}  # x is not retrievable at all
    # top-3 = a,b,c -> hits a,c -> 2 of 3 relevant
    assert metrics.recall_at_k(ranked, relevant, 3) == 2 / 3
    assert metrics.recall_at_k(ranked, relevant, 5) == 2 / 3
    assert metrics.recall_at_k(ranked, {"a"}, 1) == 1.0


def test_precision_at_k():
    ranked = ["a", "b", "c", "d"]
    relevant = {"a", "c"}
    assert metrics.precision_at_k(ranked, relevant, 2) == 0.5  # a relevant, b not
    assert metrics.precision_at_k(ranked, relevant, 4) == 0.5


def test_ndcg_perfect_and_imperfect():
    relevance = {"a": 3, "b": 2, "c": 1, "d": 0}
    # perfect order -> 1.0
    assert math.isclose(metrics.ndcg_at_k(["a", "b", "c", "d"], relevance, 4), 1.0)
    # reversed order -> well below 1
    assert metrics.ndcg_at_k(["d", "c", "b", "a"], relevance, 4) < 0.8


def test_rank_of():
    assert metrics.rank_of(["x", "y", "z"], "y") == 2
    assert metrics.rank_of(["x", "y"], "q") is None


def test_spearman_monotonic():
    # perfectly monotonic increasing -> +1
    assert math.isclose(metrics.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
    # perfectly reversed -> -1
    assert math.isclose(metrics.spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1.0)


def test_kendall_tau():
    assert math.isclose(metrics.kendall_tau([1, 2, 3], [1, 2, 3]), 1.0)
    assert math.isclose(metrics.kendall_tau([1, 2, 3], [3, 2, 1]), -1.0)


def test_tier_confusion():
    labels = ["Strong Match", "Good Match", "Weak Match"]
    pred = ["Strong Match", "Good Match", "Weak Match", "Weak Match"]
    true = ["Strong Match", "Good Match", "Good Match", "Weak Match"]
    out = metrics.tier_confusion(pred, true, labels)
    assert out["n"] == 4
    assert math.isclose(out["accuracy"], 3 / 4)
    # one Good(true) was predicted Weak -> matrix[1][2] == 1
    assert out["matrix"][1][2] == 1


def test_skill_pr():
    out = metrics.skill_pr(["Python", "docker", "SQL"], ["python", "Docker", "FastAPI"])
    # matched: python, docker -> tp=2; pred=3 -> P=2/3; gold=3 -> R=2/3
    assert math.isclose(out["precision"], 2 / 3)
    assert math.isclose(out["recall"], 2 / 3)
    assert math.isclose(out["f1"], 2 / 3)


def test_variance_and_flip_rate():
    v = metrics.variance_stats([80, 82, 78])
    assert v["range"] == 4
    assert math.isclose(v["mean"], 80.0)
    # item 0 flips (Strong vs Good), item 1 stable
    runs = [["Strong Match", "Weak Match"], ["Good Match", "Weak Match"]]
    assert metrics.flip_rate(runs) == 0.5


def test_bias_deltas():
    out = metrics.bias_deltas([(80, 80), (75, 78), (90, 88)])
    # deltas: 0, +3, -2 -> mean 1/3, max_abs 3
    assert math.isclose(out["mean_delta"], 1 / 3)
    assert out["max_abs"] == 3
