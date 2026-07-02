// Typed client for the FastAPI backend. The built site is served by FastAPI, so
// /api is same-origin in production; the Astro dev server proxies /api to :8080
// (see astro.config.mjs). Every wrapper throws an Error carrying the server's
// `detail` message on a non-2xx response, so callers can surface it directly.

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ------------------------------- JD repository ------------------------------ */

export interface JdFields {
  title: string;
  location?: string;
  reporting?: string;
  experience?: string;
  skills?: string;
  responsibilities?: string;
  requirements?: string;
}

export interface JdRecord extends JdFields {
  id: number;
  content: string;
  created_at?: string;
  updated_at?: string;
}

export const jd = {
  list: (search?: string) =>
    req<{ jds: JdRecord[] }>(`/jds${search ? `?search=${encodeURIComponent(search)}` : ""}`).then((r) => r.jds),
  get: (id: number) => req<JdRecord>(`/jds/${id}`),
  generate: (fields: JdFields) =>
    req<{ body: string; preview: string }>("/jds/generate", json(fields)),
  generateSkills: (title: string) =>
    req<{ skills: string }>("/jds/generate-skills", json({ title })).then((r) => r.skills),
  generateResponsibilities: (title: string) =>
    req<{ responsibilities: string }>("/jds/generate-responsibilities", json({ title })).then((r) => r.responsibilities),
  create: (fields: JdFields, body: string) => req<JdRecord>("/jds", json({ ...fields, body })),
  update: (id: number, fields: JdFields, content?: string) =>
    req<JdRecord>(`/jds/${id}`, { ...json({ ...fields, content }), method: "PUT" }),
  remove: (id: number) => req<{ deleted: number }>(`/jds/${id}`, { method: "DELETE" }),
  downloadMd: (id: number) => `${BASE}/jds/${id}/download`,
  downloadDocx: (id: number) => `${BASE}/jds/${id}/download.docx`,
};

/* -------------------------------- Screening -------------------------------- */

export interface ScreeningResult {
  filename: string;
  candidate_name: string;
  candidate_email?: string | null;
  similarity: number;
  shortlisted: boolean;
  overall_score: number | null;
  recommendation: string | null;
  scores?: Record<string, number>;
  strengths?: string[];
  missing_requirements?: string[];
  required_skills_matched?: string[];
  required_skills_missing?: string[];
  preferred_skills_matched?: string[];
  years_experience_estimate?: number | string | null;
  education?: string[];
  experience?: string[];
  projects?: string[];
  certifications?: string[];
  achievements?: string[];
  summary?: string;
  error?: string;
}

export type ScreeningStatus =
  | "extracting"
  | "embedding"
  | "extracting_requirements"
  | "evaluating"
  | "complete"
  | "error";

export interface ScreeningRun {
  id: string;
  status: ScreeningStatus;
  jd_name: string;
  total: number;
  shortlisted: number;
  evaluated: number;
  file_errors: { filename: string; error: string }[];
  results: ScreeningResult[];
  jd_requirements?: Record<string, unknown>;
  error?: string;
}

export interface ScreeningInput {
  resumes: File[];
  topK: number;
  jdId?: number;
  jdFiles?: File[];
}

export interface ShortlistCandidate {
  candidate_key: string;
  candidate_name: string;
  candidate_email?: string | null;
  overall_score: number | null;
  recommendation: string | null;
  has_resume: boolean;
  interviewed: boolean;
}

export interface Shortlist {
  run_id: string;
  jd_id: number | null;
  jd_name: string;
  role: string;
  jd_text: string;
  candidates: ShortlistCandidate[];
}

export const screening = {
  create: ({ resumes, topK, jdId, jdFiles }: ScreeningInput) => {
    const form = new FormData();
    form.append("top_k", String(topK));
    resumes.forEach((f) => form.append("resumes", f, f.name));
    if (jdId != null) form.append("jd_id", String(jdId));
    (jdFiles ?? []).forEach((f) => form.append("jd_files", f, f.name));
    return req<{ run_id: string; total: number }>("/screenings", { method: "POST", body: form });
  },
  get: (runId: string) => req<ScreeningRun>(`/screenings/${runId}`),
  shortlist: (runId: string) => req<Shortlist>(`/screenings/${runId}/shortlist`),
  reportUrl: (runId: string) => `${BASE}/screenings/${runId}/report.xlsx`,
};

/* -------------------------------- Interview -------------------------------- */

export interface PlannedQuestion {
  topic: string;
  question: string;
  difficulty: "easy" | "medium" | "hard";
  round: "technical" | "hr";
  is_followup?: boolean;
}

export interface Evaluation {
  technical_score: number;
  communication_score: number;
  completeness_score: number;
  confidence_score: number;
  problem_solving_score: number;
  analytical_thinking_score: number;
  domain_expertise_score: number;
  evidence?: Record<string, string>;
  missing_points: string[];
  suggested_answer: string;
  follow_up_needed: boolean;
  follow_up_question?: string | null;
}

export interface InterviewTurn {
  question: PlannedQuestion;
  answer: string;
  evaluation: Evaluation;
}

export interface FinalReport {
  overall_score: number;
  technical_skills: number;
  communication: number;
  confidence: number;
  problem_solving: number;
  analytical_thinking: number;
  domain_expertise: number;
  strengths: string[];
  weaknesses: string[];
  flags: string[];
  recommendation: "Strong Hire" | "Hire" | "Maybe" | "No Hire";
  summary: string;
}

export interface InterviewStartInput {
  candidate_name?: string;
  candidate_email?: string;
  role?: string;
  experience_level?: string;
  resume_text?: string;
  job_description?: string;
  max_questions?: number;
  // From-screening mode: role/JD/resume are resolved server-side from the run.
  run_id?: string;
  candidate_key?: string;
}

export interface InterviewStartResponse {
  thread_id: string;
  question: PlannedQuestion;
  role: string;
  candidate_name: string;
  total_questions: number;
}

export interface InterviewAnswerResponse {
  thread_id: string;
  last_turn: InterviewTurn | null;
  question: PlannedQuestion | null;
  transcript: InterviewTurn[];
  report: FinalReport | null;
  done: boolean;
  total_questions?: number;
  difficulty_adapted?: boolean;
}

export const interview = {
  start: (input: InterviewStartInput) => req<InterviewStartResponse>("/interview/start", json(input)),
  answer: (threadId: string, answer: string) =>
    req<InterviewAnswerResponse>("/interview/answer", json({ thread_id: threadId, answer })),
  transcribeAudio: (audio: Blob) => {
    const form = new FormData();
    form.append("audio", audio, "recording.webm");
    return req<{ text: string }>("/interview/transcribe", { method: "POST", body: form });
  },
};

/* --------------------------------- Dashboard ------------------------------- */

export interface ScreeningRunSummary {
  run_id: string;
  jd_id: number | null;
  jd_name: string;
  role: string | null;
  total: number;
  shortlisted: number;
  status: string;
  created_at: string;
  interviewed_count: number;
}

export interface InterviewRecord {
  id: number;
  thread_id: string | null;
  run_id: string | null;
  candidate_key: string | null;
  candidate_name: string;
  candidate_email?: string | null;
  role: string | null;
  status: "in_progress" | "completed" | "expired";
  overall_score: number | null;
  recommendation: string | null;
  created_at: string;
  updated_at: string;
}

export const dashboard = {
  screeningRuns: () =>
    req<{ runs: ScreeningRunSummary[] }>("/screening-runs").then((r) => r.runs),
  interviews: () =>
    req<{ interviews: InterviewRecord[] }>("/interviews").then((r) => r.interviews),
  interviewsForRun: (runId: string) =>
    req<{ interviews: InterviewRecord[] }>("/interviews").then((r) =>
      r.interviews.filter((i) => i.run_id === runId)),
};

/* --------------------------- Document extraction --------------------------- */

/** Extract plain text from one uploaded document (PDF, DOCX, TXT, MD). */
export const extractDocument = (file: File) => {
  const form = new FormData();
  form.append("file", file, file.name);
  return req<{ filename: string; text: string; chars: number }>("/extract", { method: "POST", body: form });
};
