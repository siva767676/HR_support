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
  prompt = f"""You are an expert recruiter at MY HOME GROUP, a leading Engineering & Construction organization.
Given the job title below, generate a comma-separated list of core technical and soft skills required for this role.
Be specific to construction/engineering domain. Output ONLY the comma-separated list, no explanation.

Job title: {title or '(unspecified)'}"""
  result = await evaluator.chat_text(prompt)
  return result.strip()


async def generate_responsibilities(title: str) -> str:
  """Generate key responsibilities for a job role as a bullet-point list."""
  prompt = f"""You are an expert recruiter at MY HOME GROUP, a leading Engineering & Construction organization.
Given the job title below, generate 4-6 key responsibilities for this role.
Format as bullet points (each line starts with '- '), be specific to construction/engineering domain.
Output ONLY the bullet list, no explanation, no title.

Job title: {title or '(unspecified)'}"""
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
