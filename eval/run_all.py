"""Benchmark entry point.

  python -m eval.run_all                 # Stage-1 (local) + all LLM phases if host reachable
  python -m eval.run_all --stage1-only   # local only, no LLM
  python -m eval.run_all --recompute      # rebuild report/checks from cached results.json (no LLM)
  python -m eval.run_all --repeats 5 --k 8

Writes eval/results/report.md + results.json, and persists raw per-eval outputs
under eval/results/raw/ so metrics recompute without re-calling the LLM.
"""

from __future__ import annotations

import argparse
import asyncio
import json

import numpy as np

from app import config, evaluator, scoring
from eval import metrics, report, runner

RESULTS = runner.RESULTS

# Proposed targets (tunable with the user). These drive the PASS/FAIL gates.
TARGETS = {
    "stage1_recall_at5": 0.95,
    "stage1_best_rank": 1,
    "stage2_spearman": 0.70,
    "stage2_skill_f1": 0.80,
    "consistency_flip_rate": 0.05,
    "consistency_range": 6.0,
    "batch_vs_single": 5.0,
    "bias_max_abs": 5.0,
    "fail_rate": 0.0,
}


def _relevant_set(labels, jid):
    thr = labels["jds"][jid]["relevant_threshold"]
    return [rid for rid, info in labels["resumes"].items()
            if info["relevance"].get(jid, 0) >= thr]


def _best_fit(labels, jid):
    return max(labels["resumes"], key=lambda rid: labels["resumes"][rid]["relevance"].get(jid, 0))


# ----------------------------- Stage 1 (local) -----------------------------

async def run_stage1(labels, jd_texts, resume_texts) -> dict:
    pool = list(resume_texts.items())
    per_jd = {}
    for jid, jd_text in jd_texts.items():
        ranking = await runner.stage1_rank(jd_text, pool)
        ranked_ids = [r["id"] for r in ranking]
        relevant = _relevant_set(labels, jid)
        relevance = {rid: labels["resumes"][rid]["relevance"].get(jid, 0) for rid in resume_texts}
        per_jd[jid] = {
            "ranking": ranking,
            "relevant": relevant,
            "recall_at": {k: metrics.recall_at_k(ranked_ids, relevant, k) for k in (2, 3, 5, 8)},
            "precision_at": {k: metrics.precision_at_k(ranked_ids, relevant, k) for k in (3, 5)},
            "ndcg": metrics.ndcg_at_k(ranked_ids, relevance, len(ranked_ids)),
            "rank_of_best": metrics.rank_of(ranked_ids, _best_fit(labels, jid)),
        }
    runner.save_raw("stage1", per_jd)
    return {"per_jd": per_jd}


# ----------------------------- Stage 2 + reliability + fairness (LLM) -----------------------------

async def run_llm_phases(labels, jd_texts, resume_texts, cf_texts, stage1, k, repeats) -> dict:
    s2_per_jd, cons_items, bias_rows, all_latencies = {}, [], [], []
    failures = 0
    batch_abs_deltas = []

    for jid, jd_text in jd_texts.items():
        requirements = await evaluator.extract_jd_requirements(jd_text)
        req_skills = labels["jds"][jid]["required_skills"]

        # Evaluate top-k shortlist UNION graded fits, so Stage-2 accuracy is
        # measurable independent of Stage-1 recall.
        ranked_ids = [r["id"] for r in stage1["per_jd"][jid]["ranking"]]
        graded = [rid for rid, info in labels["resumes"].items()
                  if info["relevance"].get(jid, 0) >= 2]
        eval_ids = list(dict.fromkeys(ranked_ids[:k] + graded))

        rows, single_scores = [], {}
        for rid in eval_ids:
            res = await runner.stage2_eval(jd_text, requirements, resume_texts[rid])
            runner.save_raw(f"s2_{jid}_{rid}", res)
            all_latencies.append(res["latency_s"])
            if not res["ok"]:
                failures += 1
                continue
            single_scores[rid] = res["overall_score"]
            planted_req = [s for s in labels["resumes"][rid]["skills_present"].get(jid, [])
                           if s in req_skills]
            rows.append({
                "id": rid, "relevance": labels["resumes"][rid]["relevance"].get(jid, 0),
                "score": res["overall_score"], "tier": res["recommendation"],
                "skill_pr": metrics.skill_pr(res["required_skills_matched"], planted_req),
            })

        rels = [r["relevance"] for r in rows]
        scores = [r["score"] for r in rows]
        by_grade = {}
        for r in rows:
            by_grade.setdefault(r["relevance"], []).append(r["score"])
        grade_means = [float(np.mean(by_grade[g])) for g in sorted(by_grade)]
        monotonic = all(b >= a - 1e-9 for a, b in zip(grade_means, grade_means[1:]))
        graded_rows = [r for r in rows if r["relevance"] >= 2]
        skill_f1 = float(np.mean([r["skill_pr"]["f1"] for r in graded_rows])) if graded_rows else float("nan")
        s2_per_jd[jid] = {
            "rows": sorted(rows, key=lambda r: r["score"], reverse=True),
            "spearman": metrics.spearman(scores, rels),
            "kendall": metrics.kendall_tau(scores, rels),
            "monotonic": monotonic,
            "skill_f1": skill_f1,
        }

        # batch vs single on the same shortlist
        shortlist = ranked_ids[:k]
        batch = await evaluator.evaluate_resumes_batch(
            jd_text, requirements, [(rid, resume_texts[rid]) for rid in shortlist])
        for rid, ev in zip(shortlist, batch):
            if ev and rid in single_scores:
                batch_abs_deltas.append(abs(scoring.overall_score(ev.get("scores", {})) - single_scores[rid]))

        # consistency: repeat perfect + partial
        prefix = "py" if jid == "python_backend" else "fe"
        for rid in [f"{prefix}_perfect", f"{prefix}_partial"]:
            reps = []
            for _ in range(repeats):
                res = await runner.stage2_eval(jd_text, requirements, resume_texts[rid])
                all_latencies.append(res["latency_s"])
                if res["ok"]:
                    reps.append({"score": res["overall_score"], "tier": res["recommendation"]})
                else:
                    failures += 1
            cons_items.append({"id": f"{jid}/{rid}", "reps": reps,
                               "stats": metrics.variance_stats([r["score"] for r in reps])})

        # bias counterfactuals for this JD
        for pair in labels["counterfactual_pairs"]:
            if pair["jd"] != jid:
                continue
            for v in pair["variants"]:
                res = await runner.stage2_eval(jd_text, requirements, cf_texts[v["id"]])
                all_latencies.append(res["latency_s"])
                if not res["ok"]:
                    failures += 1
                bias_rows.append({"jd": jid, "id": v["id"], "identity": v["identity"],
                                  "score": res["overall_score"] if res["ok"] else None})

    max_range = max((it["stats"]["range"] for it in cons_items if it["stats"]["n"]), default=float("nan"))
    batch_mean_abs = float(np.mean(batch_abs_deltas)) if batch_abs_deltas else float("nan")
    consistency = {"repeats": repeats, "items": cons_items, "max_range": max_range,
                   "batch_vs_single_mean_abs": batch_mean_abs}  # flip_rate filled by build_checks

    # bias deltas: pair the two identity variants within each JD (they should be equal)
    by_jd = {}
    for r in bias_rows:
        by_jd.setdefault(r["jd"], []).append(r)
    pairs = [(rs[0]["score"], rs[1]["score"]) for rs in by_jd.values()
             if len([x for x in rs if x["score"] is not None]) >= 2]
    bias = {"rows": bias_rows, "deltas": metrics.bias_deltas(pairs)}

    lat = np.asarray(all_latencies, dtype=float)
    operational = {
        "n": int(lat.size), "failures": failures,
        "latency_mean": float(lat.mean()) if lat.size else float("nan"),
        "latency_p50": float(np.percentile(lat, 50)) if lat.size else float("nan"),
        "latency_p95": float(np.percentile(lat, 95)) if lat.size else float("nan"),
    }
    return {"stage2": {"per_jd": s2_per_jd}, "consistency": consistency,
            "bias": bias, "operational": operational}


# ----------------------------- checks (single source of truth) -----------------------------

def _consistency_flip_rate(consistency: dict) -> float:
    """Fraction of repeated items whose tier was NOT identical across all repeats."""
    items = [it for it in consistency.get("items", []) if it.get("reps")]
    if not items:
        return float("nan")
    flips = sum(1 for it in items if len({r["tier"] for r in it["reps"]}) > 1)
    return flips / len(items)


def build_checks(results: dict) -> list[dict]:
    """Compute every PASS/FAIL gate from the assembled results — used by both live
    runs and --recompute, so the report is always consistent with the data."""
    checks = []
    s1 = results.get("stage1", {}).get("per_jd", {})
    if s1:
        # recall_at keys are ints in a live run but strings after a JSON round-trip
        ra5 = lambda d: d["recall_at"][5] if 5 in d["recall_at"] else d["recall_at"]["5"]
        min_recall5 = min(ra5(d) for d in s1.values())
        worst_best_rank = max(d["rank_of_best"] for d in s1.values())
        mean_ndcg = float(np.mean([d["ndcg"] for d in s1.values()]))
        checks += [
            {"dim": "Stage 1", "name": "min recall@5", "value": min_recall5,
             "target": f">= {TARGETS['stage1_recall_at5']}", "pass": min_recall5 >= TARGETS["stage1_recall_at5"]},
            {"dim": "Stage 1", "name": "worst rank of best-fit", "value": worst_best_rank,
             "target": f"<= {TARGETS['stage1_best_rank']}", "pass": worst_best_rank <= TARGETS["stage1_best_rank"]},
            {"dim": "Stage 1", "name": "mean NDCG", "value": mean_ndcg, "target": "(info)", "pass": None},
        ]

    s2 = results.get("stage2", {}).get("per_jd", {})
    if s2:
        sp = [d["spearman"] for d in s2.values() if d["spearman"] == d["spearman"]]
        f1 = [d["skill_f1"] for d in s2.values() if d["skill_f1"] == d["skill_f1"]]
        min_sp, min_f1 = (min(sp) if sp else float("nan")), (min(f1) if f1 else float("nan"))
        checks += [
            {"dim": "Stage 2", "name": "min Spearman(score,relevance)", "value": min_sp,
             "target": f">= {TARGETS['stage2_spearman']}", "pass": min_sp >= TARGETS["stage2_spearman"]},
            {"dim": "Stage 2", "name": "min skill-match F1", "value": min_f1,
             "target": f">= {TARGETS['stage2_skill_f1']}", "pass": min_f1 >= TARGETS["stage2_skill_f1"]},
        ]

    cons = results.get("consistency")
    if cons:
        flip = _consistency_flip_rate(cons)
        cons["flip_rate"] = flip  # write back so the report shows the corrected value
        checks += [
            {"dim": "Consistency", "name": "tier flip rate", "value": flip,
             "target": f"<= {TARGETS['consistency_flip_rate']}", "pass": flip <= TARGETS["consistency_flip_rate"]},
            {"dim": "Consistency", "name": "max score range", "value": cons["max_range"],
             "target": f"<= {TARGETS['consistency_range']}", "pass": cons["max_range"] <= TARGETS["consistency_range"]},
            {"dim": "Consistency", "name": "batch-vs-single mean |Δ|", "value": cons["batch_vs_single_mean_abs"],
             "target": f"<= {TARGETS['batch_vs_single']}", "pass": cons["batch_vs_single_mean_abs"] <= TARGETS["batch_vs_single"]},
        ]

    bias = results.get("bias")
    if bias:
        ma = bias["deltas"]["max_abs"]
        checks.append({"dim": "Fairness", "name": "max |Δ| across identity swaps", "value": ma,
                       "target": f"<= {TARGETS['bias_max_abs']}", "pass": ma <= TARGETS["bias_max_abs"]})

    op = results.get("operational")
    if op:
        fail_rate = op["failures"] / op["n"] if op["n"] else float("nan")
        checks.append({"dim": "Operational", "name": "eval failure rate", "value": fail_rate,
                       "target": f"<= {TARGETS['fail_rate']}", "pass": fail_rate <= TARGETS["fail_rate"]})
    return checks


def _write(results: dict):
    results["checks"] = build_checks(results)
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    (RESULTS / "report.md").write_text(report.render(results), encoding="utf-8")
    passed = sum(1 for c in results["checks"] if c["pass"] is True)
    failed = sum(1 for c in results["checks"] if c["pass"] is False)
    info = sum(1 for c in results["checks"] if c["pass"] is None)
    print(f"Checks: {passed} passed, {failed} failed, {info} info -> {RESULTS / 'report.md'}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage1-only", action="store_true")
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--recompute", action="store_true",
                    help="rebuild checks/report from cached results.json (no LLM)")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--k", type=int, default=6)
    args = ap.parse_args()

    if args.recompute:
        results = json.loads((RESULTS / "results.json").read_text(encoding="utf-8"))
        _write(results)
        print("Recomputed from cache (no LLM calls).")
        return

    labels, jd_texts, resume_texts, cf_texts = runner.load_golden()
    results = {"note": "Constructed golden set (deterministic ground truth). "
                       "Targets are proposed and tunable."}
    results["stage1"] = await run_stage1(labels, jd_texts, resume_texts)

    reachable, detail = runner.llm_reachable()
    ran_llm = reachable and not args.stage1_only and not args.no_llm
    results["llm"] = {"reachable": reachable, "detail": detail, "ran": ran_llm,
                      "model": config.VLLM_MODEL, "base_url": config.VLLM_BASE_URL}
    if ran_llm:
        results.update(await run_llm_phases(
            labels, jd_texts, resume_texts, cf_texts, results["stage1"], args.k, args.repeats))

    _write(results)
    print(f"LLM: {detail} | phases {'ran' if ran_llm else 'skipped'}")


if __name__ == "__main__":
    asyncio.run(main())
