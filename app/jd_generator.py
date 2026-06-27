"""AI Job Description generator — turns recruiter inputs into a structured,
professional JD body (Markdown) via the LLM. The standard company formatting is
applied separately at save time by app.jd_store.apply_template."""

from __future__ import annotations

from . import evaluator

_PROMPT = """You are an expert recruiter and copywriter at MY HOME GROUP, a leading Engineering & \
Construction organization specializing in high-rise building projects. Write a clear, professional, \
inclusive Job Description in Markdown that follows our company's STANDARD structure exactly, matching \
the tone and layout of our existing job descriptions.

Inputs:
Job title: {title}
Location: {location}
Reporting to: {reporting}
Experience level: {experience}
Required skills: {skills}
Key responsibilities (raw notes): {responsibilities}
Other requirements: {requirements}

Produce these sections, in this order, using `##` headings:

## About the Opportunity
A 2-4 sentence introduction. Open with our context as a leading Engineering & Construction
organization specializing in high-rise building projects, then describe this opportunity and the
growth it offers. Ground it in the construction / built-environment domain.

## Role & Responsibilities
One short overview paragraph describing the function/team this role sits in and its purpose within
the organization.

## Key Responsibilities
Organise the responsibilities into 3-6 NUMBERED, themed groups. Each group is a bold sub-heading
like "**1. <Theme>**" followed by 3-6 concise bullet points. Expand the raw notes into well-grouped
themes appropriate to the role.

## Qualifications & Skills
Then these three labelled lines, in this exact order, using these exact bold labels:
**Education:** the degree(s) and field(s) expected.
**Year of Experience:** restate the experience level (e.g. "0-1 years (Recent Graduates are encouraged to apply).").
**Core Competencies:**
followed by a bullet list of 6-10 key competencies/skills, each starting with a short **bold lead-in**
(e.g. "**Python & Backend:** ...") where it reads naturally.

Guidelines:
- Active voice; neutral, inclusive, non-discriminatory language.
- Do NOT invent salary or company-confidential details.
- Do NOT add the Job Title / Location / Reporting / Company Link header block — our template adds it.
- Output ONLY the Markdown body, starting at "## About the Opportunity". No preamble, no code fences."""


async def generate_skills(title: str) -> str:
  """Generate a comma-separated list of required skills for a job role."""
  prompt = f"""You are an expert recruiter at MY HOME GROUP, specializing in talent acquisition across multiple domains, including Engineering, Construction, IT, AI, Finance, HR, and Operations.

Your task is to generate a comma-separated list of ONLY the most relevant skills required for the given job title.

Rules:

* Generate skills strictly related to the provided job title.
* Do NOT include skills from unrelated domains.
* Include only skills that are genuinely expected for someone performing this role.
* Include:

  * Core technical skills
  * Relevant frameworks, libraries, tools, platforms, and software
  * Important soft skills specific to the role
* If the role belongs to Construction/Engineering, include only construction-specific skills relevant to that role.
* If the role belongs to IT/AI/Software, do NOT include any construction-related skills.
* If the role belongs to a non-technical domain (HR, Finance, Marketing, etc.), include only skills relevant to that domain.
* Avoid generic skills unless they are truly essential.
* Avoid duplicate skills.
* Do not explain your choices.

Examples:

* "AI Engineer" → Python, PyTorch, TensorFlow, Transformers, LangChain, Docker, Kubernetes, MLOps, AWS, Problem Solving
* "Quantity Surveyor" → BOQ, Estimation, Cost Control, AutoCAD, Primavera P6, Contract Management, Billing, Quantity Takeoff
* "HR Manager" → Talent Acquisition, Employee Relations, HRIS, Performance Management, Communication

Output Requirements:

* Return ONLY a comma-separated list.
* No headings.
* No numbering.
* No bullet points.
* No explanations.

Job Title: {title or "(unspecified)"}
"""
  result = await evaluator.chat_text(prompt)
  return result.strip()


async def generate_responsibilities(title: str) -> str:
  """Generate key responsibilities for a job role as a bullet-point list."""
  prompt = f"""You are an expert recruiter at MY HOME GROUP, specializing in talent acquisition across multiple domains, including Engineering, Construction, IT, AI, Finance, HR, Operations, and Corporate functions.

Your task is to generate 4-6 key responsibilities for the given job title.

Rules:

* Generate responsibilities strictly relevant to the provided job title.
* Do NOT include responsibilities from unrelated domains.
* The responsibilities should reflect real-world industry standards and expectations for this role.
* Be specific and action-oriented.
* Use professional language suitable for a Job Description (JD).
* If the role belongs to Construction/Engineering, include construction-specific responsibilities relevant to that role.
* If the role belongs to IT/AI/Software, do NOT include any construction-related responsibilities.
* If the role belongs to HR, Finance, Marketing, or other business domains, include only responsibilities relevant to those domains.
* Avoid generic responsibilities unless they are truly essential.
* Avoid duplicate or overlapping responsibilities.

Examples:

* AI Engineer → model development, deployment, MLOps, data pipeline optimization, model evaluation.
* Quantity Surveyor → BOQ preparation, cost estimation, billing, contract management, quantity takeoff.
* HR Manager → talent acquisition, employee engagement, performance management, policy implementation.

Output Requirements:

* Return ONLY a bullet list.
* Each line must start with "- ".
* Do NOT include headings, titles, numbering, or explanations.

Job Title: {title or "(unspecified)"}
"""
  result = await evaluator.chat_text(prompt)
  return result.strip()


async def generate_jd(
    title: str,
    experience: str = "",
    skills: str = "",
    responsibilities: str = "",
    requirements: str = "",
    location: str = "",
    reporting: str = "",
) -> str:
    prompt = _PROMPT.format(
        title=title or "(unspecified)",
        location=location or "(unspecified)",
        reporting=reporting or "(unspecified)",
        experience=experience or "(unspecified)",
        skills=skills or "(unspecified)",
        responsibilities=responsibilities or "(unspecified)",
        requirements=requirements or "(none)",
    )
    body = await evaluator.chat_text(prompt)
    # strip an accidental code fence or leading title heading if the model added one
    body = body.strip()
    if body.startswith("```"):
        body = body.strip("`")
        if body[:8].lower().startswith("markdown"):
            body = body[8:]
    return body.strip()
