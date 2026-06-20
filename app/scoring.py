from . import config


def overall_score(scores: dict) -> float:
    total = 0.0
    for key, weight in config.WEIGHTS.items():
        value = scores.get(key) or 0
        total += weight * max(0.0, min(100.0, float(value)))
    return round(total, 1)


def recommendation(score: float) -> str:
    if score >= 75:
        return "Strong Match"
    if score >= 55:
        return "Good Match"
    return "Weak Match"
