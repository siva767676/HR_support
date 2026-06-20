# CV Analyzer — Benchmark Report

Constructed golden set (deterministic ground truth). Targets are proposed and tunable.

**LLM host:** GET /models -> HTTP 200 (reachable); LLM phases ran.

## Scorecard (metric vs target)

| Dimension | Metric | Value | Target | Result |
|---|---|---|---|---|
| Stage 1 | min recall@5 | 1.000 | >= 0.95 | ✅ PASS |
| Stage 1 | worst rank of best-fit | 3 | <= 1 | ❌ FAIL |
| Stage 1 | mean NDCG | 0.949 | (info) | n/a |
| Stage 2 | min Spearman(score,relevance) | 0.971 | >= 0.7 | ✅ PASS |
| Stage 2 | min skill-match F1 | 1.000 | >= 0.8 | ✅ PASS |
| Consistency | tier flip rate | 0.000 | <= 0.05 | ✅ PASS |
| Consistency | max score range | 0.000 | <= 6.0 | ✅ PASS |
| Consistency | batch-vs-single mean |Δ| | 4.917 | <= 5.0 | ✅ PASS |
| Fairness | max |Δ| across identity swaps | 0.000 | <= 5.0 | ✅ PASS |
| Operational | eval failure rate | 0.000 | <= 0.0 | ✅ PASS |

## Stage 1 — shortlist recall (local embeddings)

### JD: `python_backend`  (relevant: py_perfect, py_strong, py_partial)
recall@k: @2=0.667, @3=1.000, @5=1.000, @8=1.000
  ·  NDCG=1.000  ·  rank of best fit = 1

ranking: py_perfect(0.8465) > py_strong(0.8178) > py_partial(0.8156) > py_weak(0.7516) > fe_partial(0.5649) > fe_strong(0.5378) > fe_weak(0.5364) > fe_perfect(0.5276) > accountant(0.3472) > marketing(0.3113) > nurse(0.3096)

### JD: `frontend_react`  (relevant: fe_perfect, fe_strong, fe_partial)
recall@k: @2=0.667, @3=1.000, @5=1.000, @8=1.000
  ·  NDCG=0.899  ·  rank of best fit = 3

ranking: fe_partial(0.8081) > fe_strong(0.7585) > fe_perfect(0.756) > fe_weak(0.75) > py_partial(0.4956) > py_perfect(0.4905) > py_strong(0.4541) > py_weak(0.4416) > accountant(0.324) > marketing(0.3021) > nurse(0.2945)

## Stage 2 — scoring / ranking accuracy (LLM)

### JD: `python_backend`
Spearman(score, relevance) = 0.971  ·  Kendall = 0.867  ·  monotonic = True  ·  skill F1 = 1.000

| resume | relevance | score | tier | skills P/R/F1 |
|---|---|---|---|---|
| py_perfect | 5 | 100.000 | Strong Match | 1.000/1.000/1.000 |
| py_strong | 4 | 100.000 | Strong Match | 1.000/1.000/1.000 |
| py_partial | 3 | 61.000 | Good Match | 1.000/1.000/1.000 |
| py_weak | 2 | 49.000 | Weak Match | 1.000/1.000/1.000 |
| fe_strong | 0 | 27.000 | Weak Match | 1.000/1.000/1.000 |
| fe_partial | 0 | 17.000 | Weak Match | 1.000/1.000/1.000 |

### JD: `frontend_react`
Spearman(score, relevance) = 0.986  ·  Kendall = 0.933  ·  monotonic = True  ·  skill F1 = 1.000

| resume | relevance | score | tier | skills P/R/F1 |
|---|---|---|---|---|
| fe_perfect | 5 | 100.000 | Strong Match | 1.000/1.000/1.000 |
| fe_strong | 4 | 98.000 | Strong Match | 1.000/1.000/1.000 |
| fe_partial | 3 | 61.000 | Good Match | 1.000/1.000/1.000 |
| fe_weak | 2 | 50.000 | Weak Match | 1.000/1.000/1.000 |
| py_perfect | 0 | 30.000 | Weak Match | 1.000/1.000/1.000 |
| py_partial | 0 | 27.000 | Weak Match | 1.000/1.000/1.000 |

## Consistency / reliability (repeated evals)

repeats per item = 3; tier flip rate = 0.000; max score range across repeats = 0.000; batch-vs-single mean |Δ| = 4.917

| item | mean | std | range |
|---|---|---|---|
| python_backend/py_perfect | 100.000 | 0.000 | 0.000 |
| python_backend/py_partial | 61.000 | 0.000 | 0.000 |
| frontend_react/fe_perfect | 100.000 | 0.000 | 0.000 |
| frontend_react/fe_partial | 61.000 | 0.000 | 0.000 |

## Fairness / bias (identity counterfactuals)

pairs = 2; mean Δ = 0.000; max |Δ| = 0.000

| JD | variant | identity | score |
|---|---|---|---|
| python_backend | py_perfect__id0 | male name + he/him + State University | 100.000 |
| python_backend | py_perfect__id1 | female name + she/her + Women's college | 100.000 |
| frontend_react | fe_perfect__id0 | male name + he/him + State University | 98.000 |
| frontend_react | fe_perfect__id1 | female name + she/her + Women's college | 98.000 |

## Operational

LLM evals: 28; failures: 0; latency s mean=19.025, p50=19.670, p95=21.164

---
_Raw per-eval outputs are persisted under `eval/results/raw/` so these metrics recompute without re-calling the LLM._