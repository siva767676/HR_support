"""Render the assembled benchmark results dict into Markdown."""

from __future__ import annotations


def _fmt(v) -> str:
    if isinstance(v, float):
        return f"{v:.3f}"
    return str(v)


def render(results: dict) -> str:
    out: list[str] = []
    out.append("# CV Analyzer — Benchmark Report")
    out.append("")
    out.append(results.get("note", ""))
    out.append("")

    llm = results.get("llm", {})
    out.append(f"**LLM host:** {llm.get('detail', 'n/a')} "
               f"({'reachable' if llm.get('reachable') else 'NOT reachable'}); "
               f"LLM phases {'ran' if llm.get('ran') else 'SKIPPED'}.")
    out.append("")

    # ---- scorecard ----
    checks = results.get("checks", [])
    if checks:
        out.append("## Scorecard (metric vs target)")
        out.append("")
        out.append("| Dimension | Metric | Value | Target | Result |")
        out.append("|---|---|---|---|---|")
        for c in checks:
            res = "n/a" if c.get("pass") is None else ("✅ PASS" if c["pass"] else "❌ FAIL")
            out.append(f"| {c['dim']} | {c['name']} | {_fmt(c['value'])} | {c.get('target','-')} | {res} |")
        out.append("")

    # ---- Stage 1 ----
    s1 = results.get("stage1")
    if s1:
        out.append("## Stage 1 — shortlist recall (local embeddings)")
        out.append("")
        for jid, d in s1["per_jd"].items():
            out.append(f"### JD: `{jid}`  (relevant: {', '.join(d['relevant'])})")
            ra = d["recall_at"]
            out.append("recall@k: " + ", ".join(f"@{k}={_fmt(v)}" for k, v in ra.items()))
            out.append(f"  ·  NDCG={_fmt(d['ndcg'])}  ·  rank of best fit = {d['rank_of_best']}")
            out.append("")
            out.append("ranking: " + " > ".join(
                f"{r['id']}({r['similarity']})" for r in d["ranking"]))
            out.append("")

    # ---- Stage 2 ----
    s2 = results.get("stage2")
    if s2:
        out.append("## Stage 2 — scoring / ranking accuracy (LLM)")
        out.append("")
        for jid, d in s2["per_jd"].items():
            out.append(f"### JD: `{jid}`")
            out.append(f"Spearman(score, relevance) = {_fmt(d['spearman'])}  ·  "
                       f"Kendall = {_fmt(d['kendall'])}  ·  monotonic = {d['monotonic']}  ·  "
                       f"skill F1 = {_fmt(d['skill_f1'])}")
            out.append("")
            out.append("| resume | relevance | score | tier | skills P/R/F1 |")
            out.append("|---|---|---|---|---|")
            for row in d["rows"]:
                pr = row["skill_pr"]
                out.append(f"| {row['id']} | {row['relevance']} | {_fmt(row['score'])} | "
                           f"{row['tier']} | {_fmt(pr['precision'])}/{_fmt(pr['recall'])}/{_fmt(pr['f1'])} |")
            out.append("")

    # ---- consistency ----
    cons = results.get("consistency")
    if cons:
        out.append("## Consistency / reliability (repeated evals)")
        out.append("")
        out.append(f"repeats per item = {cons['repeats']}; tier flip rate = {_fmt(cons['flip_rate'])}; "
                   f"max score range across repeats = {_fmt(cons['max_range'])}; "
                   f"batch-vs-single mean |Δ| = {_fmt(cons.get('batch_vs_single_mean_abs', float('nan')))}")
        out.append("")
        out.append("| item | mean | std | range |")
        out.append("|---|---|---|---|")
        for r in cons["items"]:
            v = r["stats"]
            out.append(f"| {r['id']} | {_fmt(v['mean'])} | {_fmt(v['std'])} | {_fmt(v['range'])} |")
        out.append("")

    # ---- bias ----
    bias = results.get("bias")
    if bias:
        out.append("## Fairness / bias (identity counterfactuals)")
        out.append("")
        b = bias["deltas"]
        out.append(f"pairs = {b['n']}; mean Δ = {_fmt(b['mean_delta'])}; max |Δ| = {_fmt(b['max_abs'])}")
        out.append("")
        out.append("| JD | variant | identity | score |")
        out.append("|---|---|---|---|")
        for r in bias["rows"]:
            out.append(f"| {r['jd']} | {r['id']} | {r['identity']} | {_fmt(r['score'])} |")
        out.append("")

    # ---- operational ----
    op = results.get("operational")
    if op:
        out.append("## Operational")
        out.append("")
        out.append(f"LLM evals: {op['n']}; failures: {op['failures']}; "
                   f"latency s mean={_fmt(op['latency_mean'])}, p50={_fmt(op['latency_p50'])}, "
                   f"p95={_fmt(op['latency_p95'])}")
        out.append("")

    out.append("---")
    out.append("_Raw per-eval outputs are persisted under `eval/results/raw/` so these "
               "metrics recompute without re-calling the LLM._")
    return "\n".join(out)
