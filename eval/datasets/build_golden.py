"""Deterministically build the constructed golden set.

For each JD we generate graded resumes whose relevance is known *by construction*
and whose JD-relevant skills are *planted* (so skill precision/recall has exact
ground truth). Resumes for other roles act as distractors in the shared pool, so
Stage-1 shortlist recall is a real test. Identity-swapped counterfactual variants
(identical content, different name/pronouns) give zero-label fairness truth.

Run:  python -m eval.datasets.build_golden
Output: eval/datasets/golden/{jds,resumes,counterfactual}/*.txt + labels.json
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).parent / "golden"

# ----------------------------- JD definitions -----------------------------
JDS = {
    "python_backend": {
        "title": "Senior Python Backend Engineer",
        "required_skills": ["Python", "FastAPI", "PostgreSQL", "Docker", "REST APIs"],
        "preferred_skills": ["Kubernetes", "AWS", "Redis", "CI/CD"],
        "min_years": 5,
        "domain": "backend web services",
        "relevant_threshold": 3,
    },
    "frontend_react": {
        "title": "Senior Frontend Engineer (React)",
        "required_skills": ["React", "TypeScript", "JavaScript", "CSS", "HTML"],
        "preferred_skills": ["Redux", "Next.js", "Jest", "Webpack"],
        "min_years": 4,
        "domain": "frontend web applications",
        "relevant_threshold": 3,
    },
}


def _jd_text(jd: dict) -> str:
    return (
        f"Job Title: {jd['title']}\n"
        f"Domain: {jd['domain']}\n"
        f"Minimum experience: {jd['min_years']}+ years\n\n"
        f"Required skills: {', '.join(jd['required_skills'])}.\n"
        f"Preferred skills: {', '.join(jd['preferred_skills'])}.\n\n"
        "Responsibilities: design, build and operate production systems; "
        "collaborate across teams; write tested, maintainable code; own features "
        "end to end from design through deployment and monitoring."
    )


# ----------------------------- resume rendering -----------------------------

def _resume_text(name, pronoun, title, years, skills, domain, school) -> str:
    he = pronoun  # "he"/"she"/"they"
    bullets = [
        f"Built and shipped {domain} using {', '.join(skills[:3]) if skills else 'various tools'}.",
        f"Owned features end to end; {he} led design, implementation and deployment.",
        f"Worked with {', '.join(skills[3:]) if len(skills) > 3 else 'cross-functional teams'} "
        "to deliver reliable, well-tested systems.",
    ]
    return (
        f"{name}\n{title}\n\n"
        f"Summary: {years}+ years of experience in {domain}.\n"
        f"Skills: {', '.join(skills) if skills else 'general office software'}.\n\n"
        "Experience:\n- " + "\n- ".join(bullets) + "\n\n"
        f"Education: B.S., {school}."
    )


# archetype: (suffix, relevance, name, pronoun, school, required_take, preferred_take, years)
# required_take / preferred_take = how many of the JD's skills to plant (in order)
ARCHETYPES = [
    ("perfect", 5, 7, "all", "all"),
    ("strong", 4, 5, "all", "half"),
    ("partial", 3, 3, "most", "none"),   # drop ~2 required
    ("weak", 2, 2, "few", "none"),       # only 1-2 required
]

# Distractors: relevant to neither JD (planted with unrelated skills).
DISTRACTORS = {
    "marketing": dict(
        title="Marketing Manager", years=6, domain="brand marketing and campaigns",
        skills=["SEO", "Google Analytics", "Content Strategy", "Social Media", "Copywriting"],
        school="Marketing, State University",
    ),
    "accountant": dict(
        title="Senior Accountant", years=8, domain="financial accounting and audit",
        skills=["GAAP", "Excel", "QuickBooks", "Tax Preparation", "Auditing"],
        school="Accounting, City College",
    ),
    "nurse": dict(
        title="Registered Nurse", years=5, domain="acute patient care",
        skills=["Patient Care", "Triage", "EHR", "Medication Administration"],
        school="Nursing, Health Institute",
    ),
}


def _take(skills: list[str], how: str) -> list[str]:
    n = {"all": len(skills), "half": max(1, len(skills) // 2),
         "most": max(1, len(skills) - 2), "few": min(2, len(skills)), "none": 0}[how]
    return skills[:n]


def build(out: Path = OUT) -> dict:
    (out / "jds").mkdir(parents=True, exist_ok=True)
    (out / "resumes").mkdir(parents=True, exist_ok=True)
    (out / "counterfactual").mkdir(parents=True, exist_ok=True)

    labels = {"jds": {}, "resumes": {}, "counterfactual_pairs": []}

    # JDs
    for jid, jd in JDS.items():
        path = out / "jds" / f"{jid}.txt"
        path.write_text(_jd_text(jd), encoding="utf-8")
        labels["jds"][jid] = {
            "file": f"jds/{jid}.txt",
            "required_skills": jd["required_skills"],
            "preferred_skills": jd["preferred_skills"],
            "min_years": jd["min_years"],
            "relevant_threshold": jd["relevant_threshold"],
        }

    # role names per JD for readable resume ids/titles
    role_meta = {
        "python_backend": dict(prefix="py", title="Python Backend Engineer",
                               domain="backend web services",
                               school="Computer Science, Tech University"),
        "frontend_react": dict(prefix="fe", title="Frontend Engineer",
                               domain="frontend web applications",
                               school="Computer Science, Tech University"),
    }

    def add_resume(rid, text, relevance, skills_present):
        (out / "resumes" / f"{rid}.txt").write_text(text, encoding="utf-8")
        labels["resumes"][rid] = {
            "file": f"resumes/{rid}.txt",
            "relevance": relevance,
            "skills_present": skills_present,
        }

    # Graded resumes per JD (cross-JD relevance = 0; clean skill separation)
    other = {"python_backend": "frontend_react", "frontend_react": "python_backend"}
    for jid, jd in JDS.items():
        meta = role_meta[jid]
        for suffix, rel, years, req_how, pref_how in ARCHETYPES:
            req = _take(jd["required_skills"], req_how)
            pref = _take(jd["preferred_skills"], pref_how)
            planted = req + pref
            rid = f"{meta['prefix']}_{suffix}"
            text = _resume_text(
                name=f"Candidate {rid.upper()}", pronoun="they",
                title=meta["title"], years=years, skills=planted,
                domain=meta["domain"], school=meta["school"],
            )
            add_resume(
                rid, text,
                relevance={jid: rel, other[jid]: 0},
                skills_present={jid: planted, other[jid]: []},
            )

    # Distractors: relevant to neither JD
    for did, d in DISTRACTORS.items():
        text = _resume_text(name=f"Candidate {did.upper()}", pronoun="they",
                            title=d["title"], years=d["years"], skills=d["skills"],
                            domain=d["domain"], school=d["school"])
        add_resume(did, text,
                   relevance={jid: 0 for jid in JDS},
                   skills_present={jid: [] for jid in JDS})

    # Counterfactual identity swaps on the perfect fit of each JD (content identical).
    swaps = [
        ("James Carter", "he", "State University"),
        ("Aisha Khan", "she", "Women's Engineering College"),
    ]
    for jid, jd in JDS.items():
        meta = role_meta[jid]
        planted = jd["required_skills"] + jd["preferred_skills"]
        for i, (name, pron, school) in enumerate(swaps):
            vid = f"{meta['prefix']}_perfect__id{i}"
            text = _resume_text(name=name, pronoun=pron, title=meta["title"],
                                years=7, skills=planted, domain=meta["domain"], school=school)
            (out / "counterfactual" / f"{vid}.txt").write_text(text, encoding="utf-8")
        labels["counterfactual_pairs"].append({
            "jd": jid,
            "variants": [
                {"id": f"{meta['prefix']}_perfect__id0",
                 "file": f"counterfactual/{meta['prefix']}_perfect__id0.txt",
                 "identity": "male name + he/him + State University"},
                {"id": f"{meta['prefix']}_perfect__id1",
                 "file": f"counterfactual/{meta['prefix']}_perfect__id1.txt",
                 "identity": "female name + she/her + Women's college"},
            ],
            "note": "Identical skills/experience; only identity markers differ. Scores should match.",
        })

    (out / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
    return labels


if __name__ == "__main__":
    lbl = build()
    n_jd = len(lbl["jds"])
    n_res = len(lbl["resumes"])
    n_cf = sum(len(p["variants"]) for p in lbl["counterfactual_pairs"])
    print(f"Built golden set: {n_jd} JDs, {n_res} resumes, {n_cf} counterfactual variants -> {OUT}")
