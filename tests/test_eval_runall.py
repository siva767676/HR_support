"""Regression tests for the benchmark check-builder, esp. the consistency
flip-rate computation (which earlier mis-fired due to a transposed input)."""

from eval.run_all import _consistency_flip_rate, build_checks


def test_flip_rate_zero_when_tiers_stable():
    cons = {"items": [
        {"reps": [{"tier": "Strong Match"}, {"tier": "Strong Match"}, {"tier": "Strong Match"}]},
        {"reps": [{"tier": "Good Match"}, {"tier": "Good Match"}]},
    ]}
    assert _consistency_flip_rate(cons) == 0.0


def test_flip_rate_counts_only_items_that_vary():
    cons = {"items": [
        {"reps": [{"tier": "Strong Match"}, {"tier": "Good Match"}]},   # flips
        {"reps": [{"tier": "Weak Match"}, {"tier": "Weak Match"}]},     # stable
    ]}
    assert _consistency_flip_rate(cons) == 0.5


def test_build_checks_writes_corrected_flip_back():
    results = {"consistency": {
        "items": [{"reps": [{"tier": "Strong Match"}, {"tier": "Strong Match"}]}],
        "max_range": 0.0, "batch_vs_single_mean_abs": 1.0,
    }}
    checks = build_checks(results)
    flip = next(c for c in checks if c["name"] == "tier flip rate")
    assert flip["value"] == 0.0 and flip["pass"] is True
    assert results["consistency"]["flip_rate"] == 0.0
