from app import scoring


def test_overall_score_weighted_sum():
    # All sub-scores 100 -> weighted sum is 100.
    perfect = {
        "skills_match": 100,
        "experience_match": 100,
        "education_certifications": 100,
        "domain_relevance": 100,
        "projects_achievements": 100,
    }
    assert scoring.overall_score(perfect) == 100.0

    # Only skills (40% weight) maxed -> 40.0
    assert scoring.overall_score({"skills_match": 100}) == 40.0


def test_overall_score_clamps_and_handles_missing():
    # Out-of-range values are clamped to [0, 100]; missing keys count as 0.
    assert scoring.overall_score({"skills_match": 500}) == 40.0
    assert scoring.overall_score({"skills_match": -50}) == 0.0
    assert scoring.overall_score({}) == 0.0
    # None values are treated as 0 (the `value or 0` path).
    assert scoring.overall_score({"skills_match": None}) == 0.0


def test_recommendation_thresholds():
    assert scoring.recommendation(75) == "Strong Match"
    assert scoring.recommendation(100) == "Strong Match"
    assert scoring.recommendation(74.9) == "Good Match"
    assert scoring.recommendation(55) == "Good Match"
    assert scoring.recommendation(54.9) == "Weak Match"
    assert scoring.recommendation(0) == "Weak Match"
