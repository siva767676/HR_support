import { useEffect, useState } from "react";
import { Bot, ArrowRight, Check, FileText, Upload, Users, ScanSearch, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dropdown, Field, PageHeader, Spinner, inputCls,
  SurfaceCard, SectionTitle, SegmentedControl, StatusChip, hireTone, matchTone, ScoreMeter,
  Banner, PhaseProgress, EmptyState, Stepper, SelectCard,
} from "./ui";
import { UploadZone } from "./UploadZone";
import { loadSession, saveSession, clearSession, setBusy, SESSION_KEYS } from "@/lib/session";
import {
  interview,
  jd as jdApi,
  screening as screeningApi,
  extractDocument,
  type FinalReport,
  type InterviewTurn,
  type JdRecord,
  type PlannedQuestion,
  type Shortlist,
} from "@/lib/api";
import InterviewRoom from "./InterviewRoom";

type Phase = "setup" | "running" | "done";

const LEVELS = [
  { value: "entry", label: "Entry level" },
  { value: "mid", label: "Mid level" },
  { value: "senior", label: "Senior" },
];

/* Up to two initials for a candidate avatar, from name (or filename). */
function initials(name: string): string {
  const parts = name.replace(/\.[^.]+$/, "").split(/[\s_\-.]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function InterviewModule() {
  // The interview thread lives on the server, keyed by thread_id. Persisting the
  // session state lets the user navigate away mid-interview and return to the
  // same question; a lost thread surfaces as a 409 on the next submit (handled).
  const saved = loadSession(SESSION_KEYS.interview, {
    phase: "setup" as Phase, source: "manual" as "screening" | "manual",
    candidate: "", role: "", level: "mid", maxQ: 5,
    jdMode: "repo" as "repo" | "upload", jdId: "" as number | "", jdText: "", jdFile: "",
    resumeText: "", resumeFile: "", threadId: "", question: null as PlannedQuestion | null,
    runId: "", asked: 0, total: 0, transcript: [] as InterviewTurn[], report: null as FinalReport | null,
  });
  const restorable =
    (saved.phase === "running" && !!saved.threadId && !!saved.question) ||
    (saved.phase === "done" && !!saved.report);

  const [phase, setPhase] = useState<Phase>(restorable ? saved.phase : "setup");
  const [error, setError] = useState("");

  // setup state
  const [candidate, setCandidate] = useState(saved.candidate);
  const [role, setRole] = useState(saved.role);
  const [level, setLevel] = useState(saved.level);
  const [maxQ, setMaxQ] = useState(saved.maxQ);
  const [jds, setJds] = useState<JdRecord[]>([]);
  const [jdMode, setJdMode] = useState<"repo" | "upload">(saved.jdMode);
  const [jdId, setJdId] = useState<number | "">(saved.jdId);
  const [jdText, setJdText] = useState(saved.jdText);
  const [jdFile, setJdFile] = useState(saved.jdFile);
  const [jdExtracting, setJdExtracting] = useState(false);
  const [resumeText, setResumeText] = useState(saved.resumeText);
  const [resumeFile, setResumeFile] = useState(saved.resumeFile);
  const [extracting, setExtracting] = useState(false);
  const [starting, setStarting] = useState(false);

  // running state
  const [threadId, setThreadId] = useState(saved.threadId);
  const [question, setQuestion] = useState<PlannedQuestion | null>(saved.question);
  const [submitting, setSubmitting] = useState(false);
  const [asked, setAsked] = useState(saved.asked);
  const [total, setTotal] = useState(saved.total);
  const [transcript, setTranscript] = useState<InterviewTurn[]>(saved.transcript);

  // done state
  const [report, setReport] = useState<FinalReport | null>(saved.report);

  // adaptive difficulty
  const [difficultyAdapted, setDifficultyAdapted] = useState(false);

  // screening-source state: candidates forwarded from a CV Analyzer run
  const [source, setSource] = useState<"screening" | "manual">(saved.source ?? "manual");
  const [runId, setRunId] = useState(saved.runId ?? "");
  const [shortlist, setShortlist] = useState<Shortlist | null>(null);
  const [loadingShortlist, setLoadingShortlist] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");

  useEffect(() => {
    jdApi
      .list()
      .then(setJds)
      .catch(() => setJds([]));
  }, []);

  // Persist the interview so navigating away mid-session restores the same question.
  useEffect(() => {
    saveSession(SESSION_KEYS.interview, {
      phase, source, runId, candidate, role, level, maxQ, jdMode, jdId, jdText, jdFile,
      resumeText, resumeFile, threadId, question, asked, total, transcript, report,
    });
  }, [phase, source, runId, candidate, role, level, maxQ, jdMode, jdId, jdText, jdFile, resumeText, resumeFile, threadId, question, asked, total, transcript, report]);

  // Consume a "send shortlist to interview" hand-off from the CV Analyzer.
  useEffect(() => {
    const fwd = loadSession(SESSION_KEYS.forward, { runId: "" });
    if (fwd.runId) {
      clearSession(SESSION_KEYS.forward);
      setSource("screening");
      setRunId(fwd.runId);
      fetchShortlist(fwd.runId);
    } else if (saved.source === "screening" && saved.runId) {
      fetchShortlist(saved.runId); // refresh the queue on return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchShortlist(id: string) {
    setLoadingShortlist(true);
    try {
      const sl = await screeningApi.shortlist(id);
      setShortlist(sl);
      // Auto-select the first not-yet-interviewed candidate with a resume.
      const next = sl.candidates.find((c) => !c.interviewed && c.has_resume);
      setSelectedKey((k) => k || next?.candidate_key || "");
    } catch {
      setShortlist(null);
    } finally {
      setLoadingShortlist(false);
    }
  }

  // Warn before leaving while an interview is live or being planned.
  useEffect(() => {
    setBusy(phase === "running" || starting);
    return () => setBusy(false);
  }, [phase, starting]);

  // Cancel any in-progress TTS when the module unmounts.
  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  // when a repository JD is chosen, prefill role from its title
  useEffect(() => {
    if (jdId === "") return;
    const rec = jds.find((j) => j.id === jdId);
    if (rec && !role.trim()) setRole(rec.title);
  }, [jdId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvedJd = () => {
    if (jdMode === "repo") return jdId !== "" ? jds.find((j) => j.id === jdId)?.content ?? "" : "";
    return jdText.trim();
  };

  async function pickJd(file: File | null) {
    if (!file) return;
    setError("");
    setJdFile(file.name);
    setJdText("");
    setJdExtracting(true);
    try {
      const res = await extractDocument(file);
      setJdText(res.text);
      if (!res.text.trim()) setError("No readable text was found in that JD file. Try another file or format.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
      setJdFile("");
    } finally {
      setJdExtracting(false);
    }
  }

  async function pickResume(file: File | null) {
    if (!file) return;
    setError("");
    setResumeFile(file.name);
    setResumeText("");
    setExtracting(true);
    try {
      const res = await extractDocument(file);
      setResumeText(res.text);
      if (!res.text.trim()) setError("No readable text was found in that file. Try another file or format.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
      setResumeFile("");
    } finally {
      setExtracting(false);
    }
  }

  async function startInterview() {
    setError("");
    // From-screening mode: role/JD/resume are resolved server-side from the run.
    const fromScreening = source === "screening";
    if (fromScreening) {
      if (!selectedKey) return setError("Select a candidate from the shortlist.");
    } else {
      const jobDescription = resolvedJd();
      if (!role.trim()) return setError("Enter the role you are interviewing for.");
      if (!jobDescription) return setError("Select a saved JD or upload a JD file.");
      if (!resumeText.trim()) return setError("Upload the candidate's resume.");
    }
    setStarting(true);
    try {
      const res = await interview.start(
        fromScreening
          ? { run_id: runId, candidate_key: selectedKey, experience_level: level, max_questions: maxQ }
          : {
              candidate_name: candidate.trim() || "Candidate",
              role: role.trim(),
              experience_level: level,
              resume_text: resumeText.trim(),
              job_description: resolvedJd(),
              max_questions: maxQ,
            },
      );
      if (fromScreening) setCandidate(res.candidate_name);
      setRole(res.role);
      setThreadId(res.thread_id);
      setQuestion(res.question);
      setAsked(1);
      setTotal(res.total_questions || maxQ);
      setTranscript([]);
      setReport(null);
      setPhase("running");
      // InterviewRoom handles TTS via its own useEffect([question?.question])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the interview.");
    } finally {
      setStarting(false);
    }
  }

  // After finishing a forwarded interview, return to the shortlist for the next one.
  function nextCandidate() {
    window.speechSynthesis?.cancel();
    setThreadId(""); setQuestion(null); setTranscript([]);
    setReport(null); setAsked(0); setTotal(0); setError("");
    setSelectedKey("");
    setPhase("setup");
    if (runId) fetchShortlist(runId);
  }

  // Called by InterviewRoom when voice answer is ready.
  async function handleAnswerReady(text: string) {
    if (!text.trim() || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await interview.answer(threadId, text.trim());
      setTranscript(res.transcript);
      if (res.total_questions !== undefined) setTotal(res.total_questions);
      if (res.difficulty_adapted) setDifficultyAdapted(true);
      if (res.done && res.report) {
        setReport(res.report);
        setQuestion(null);
        setPhase("done");
      } else if (res.question) {
        setQuestion(res.question);
        setAsked((n) => n + 1);
        setDifficultyAdapted(false);
        // InterviewRoom auto-speaks and auto-listens when question prop changes
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not submit the answer.";
      setError(msg);
      if ((e as { status?: number })?.status === 409) {
        setThreadId("");
        setQuestion(null);
        setPhase("setup");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    window.speechSynthesis?.cancel();
    setPhase("setup");
    setThreadId("");
    setQuestion(null);
    setTranscript([]);
    setReport(null);
    setAsked(0);
    setTotal(0);
    setError("");
    setSource("manual");
    setRunId("");
    setShortlist(null);
    setSelectedKey("");
    clearSession(SESSION_KEYS.interview);
  }

  const screeningDone = shortlist
    ? shortlist.candidates.filter((c) => c.interviewed).length
    : 0;
  const screeningTotal = shortlist?.candidates.length ?? 0;

  return (
    <div className="animate-rise">
      <PageHeader
        icon={<Bot className="size-6" />}
        eyebrow="AI Interview"
        title="AI Interview Assistant"
        description="Plan a tailored interview from a role, its job description, and the candidate's resume. MEDHA asks one question at a time, scores each answer, and produces a hiring report. Nothing is stored: the session lives in memory only."
      />

      {error && <Banner tone="error" className="mb-6">{error}</Banner>}

      {phase === "setup" && (
        <div className="space-y-5">
          <Stepper steps={["Pick", "Interview", "Report"]} current={1} className="mb-2" />
          <SelectCard
            value={source}
            onChange={(v) => setSource(v as "screening" | "manual")}
            options={[
              { value: "screening", label: "From screening", description: "Pick from shortlisted candidates", icon: <ScanSearch className="size-5" /> },
              { value: "manual", label: "Manual", description: "Upload role, JD, and resume", icon: <Upload className="size-5" /> },
            ]}
            className="mb-4"
          />

          {source === "screening" ? (
            <SurfaceCard className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionTitle className="mb-0">Shortlisted candidates</SectionTitle>
                {screeningTotal > 0 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {screeningDone} of {screeningTotal} interviewed
                  </span>
                )}
              </div>
              {screeningTotal > 0 && (
                <PhaseProgress percent={(screeningDone / Math.max(screeningTotal, 1)) * 100} caption="Interview progress" />
              )}

              {loadingShortlist ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Spinner /> Loading shortlist…</div>
              ) : !shortlist || screeningTotal === 0 ? (
                <EmptyState
                  icon={<Users className="size-7" />}
                  title="No shortlist forwarded yet"
                  description="Run a screening in CV Analyzer, then click “Send to AI Interview” to bring the shortlisted candidates here."
                  action={<a href="/screening" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"><ScanSearch className="size-4" /> Go to CV Analyzer</a>}
                />
              ) : (
                <>
                  <div className="space-y-2">
                    {shortlist.candidates.map((c) => {
                      const disabled = !c.has_resume;
                      const active = selectedKey === c.candidate_key;
                      return (
                        <button
                          key={c.candidate_key}
                          type="button"
                          disabled={disabled}
                          onClick={() => setSelectedKey(c.candidate_key)}
                          title={disabled ? "No resume text available for this candidate" : undefined}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                            active ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                            disabled && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-[11px] font-bold text-primary ring-1 ring-inset ring-primary/15">
                            {initials(c.candidate_name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{c.candidate_name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{c.candidate_key}</span>
                          </span>
                          {c.overall_score != null && (
                            <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{Math.round(c.overall_score)}</span>
                          )}
                          {c.interviewed ? (
                            <StatusChip tone="strong" size="sm"><Check className="mr-1 size-3" /> Done</StatusChip>
                          ) : c.recommendation ? (
                            <StatusChip tone={matchTone(c.recommendation)} size="sm">{c.recommendation}</StatusChip>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Experience level">
                      <Dropdown value={level} onChange={setLevel} options={LEVELS} />
                    </Field>
                    <Field label="Questions" hint="Between 1 and 12">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={12}
                        className={cn(inputCls, "no-spinner")}
                        value={maxQ || ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMaxQ(v === "" ? 0 : Math.max(0, Math.floor(Number(v) || 0)));
                        }}
                        placeholder="e.g. 5"
                      />
                    </Field>
                  </div>

                  <Button variant="brand" size="lg" onClick={startInterview} disabled={starting || !selectedKey} className="w-full">
                    {starting ? <><Spinner /> Planning the interview…</> : <>Start interview <ArrowRight /></>}
                  </Button>
                </>
              )}
            </SurfaceCard>
          ) : (
          <div className="grid gap-6 lg:grid-cols-2">
          <SurfaceCard className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Candidate name" hint="Optional">
                <input className={inputCls} value={candidate} onChange={(e) => setCandidate(e.target.value)} placeholder="e.g. Ananya Sharma" />
              </Field>
              <Field label="Role">
                <input className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Site Engineer" />
              </Field>
              <Field label="Experience level">
                <Dropdown value={level} onChange={setLevel} options={LEVELS} />
              </Field>
              <Field label="Questions" hint="Between 1 and 12">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={12}
                  className={cn(inputCls, "no-spinner")}
                  value={maxQ || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMaxQ(v === "" ? 0 : Math.max(0, Math.floor(Number(v) || 0)));
                  }}
                  placeholder="e.g. 5"
                />
              </Field>
            </div>

            <div>
              <SectionTitle>Job description</SectionTitle>
              <SegmentedControl
                className="mb-3"
                size="sm"
                value={jdMode}
                onChange={setJdMode}
                options={[
                  { value: "repo", label: "From repository" },
                  { value: "upload", label: "Upload file" },
                ]}
              />

              {jdMode === "repo" ? (
                <Dropdown
                  value={jdId === "" ? "" : String(jdId)}
                  onChange={(v) => setJdId(v === "" ? "" : Number(v))}
                  options={jds.map((j) => ({ value: String(j.id), label: j.title }))}
                  placeholder="Select a saved JD…"
                />
              ) : (
                <UploadZone
                  variant="compact"
                  mode="files"
                  multiple={false}
                  accept={[".pdf", ".docx", ".txt"]}
                  onFiles={(files) => pickJd(files[0] ?? null)}
                  busy={jdExtracting}
                  busyLabel={`Reading ${jdFile}…`}
                  title="Upload a JD file"
                  hint="PDF, DOCX, or TXT"
                  selected={jdText ? (
                    <>
                      <FileText className="size-6 text-primary" />
                      <span className="text-sm font-medium text-foreground">{jdFile}</span>
                      <span className="text-xs text-muted-foreground">{jdText.length.toLocaleString()} characters read · click to replace</span>
                    </>
                  ) : undefined}
                />
              )}
            </div>
          </SurfaceCard>

          <SurfaceCard className="flex flex-col">
            <SectionTitle>Candidate resume</SectionTitle>
            <UploadZone
              className="flex-1 py-10"
              variant="compact"
              mode="files"
              multiple={false}
              accept={[".pdf", ".docx", ".txt", ".md"]}
              onFiles={(files) => pickResume(files[0] ?? null)}
              busy={extracting}
              busyLabel={`Reading ${resumeFile}…`}
              icon={<Upload className="size-7" />}
              title="Upload a resume"
              hint="PDF, DOCX, TXT, or MD"
              selected={resumeText ? (
                <>
                  <FileText className="size-7 text-primary" />
                  <span className="text-sm font-medium text-foreground">{resumeFile}</span>
                  <span className="text-xs text-muted-foreground">{resumeText.length.toLocaleString()} characters read · click to replace</span>
                </>
              ) : undefined}
            />
            <div className="mt-auto pt-6">
              <Button variant="brand" size="lg" onClick={startInterview} disabled={starting || extracting || jdExtracting} className="w-full">
                {starting ? <><Spinner /> Planning the interview…</> : <>Start interview <ArrowRight /></>}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                The model designs {maxQ} question{maxQ === 1 ? "" : "s"} from the resume and JD. This can take a few seconds.
              </p>
            </div>
          </SurfaceCard>
          </div>
          )}
        </div>
      )}

      {phase === "running" && question && (
        <InterviewRoom
          question={question}
          asked={asked}
          total={total}
          candidate={candidate.trim() || "Candidate"}
          role={role}
          transcript={transcript}
          submitting={submitting}
          difficultyAdapted={difficultyAdapted}
          error={error}
          onAnswerReady={handleAnswerReady}
          onReset={reset}
        />
      )}

      {phase === "done" && report && (
        <div className="space-y-6">
          <Stepper steps={["Pick", "Interview", "Report"]} current={3} />
          <Report
            report={report}
            transcript={transcript}
            candidate={candidate.trim() || "Candidate"}
            role={role}
          onRestart={source === "screening" ? nextCandidate : reset}
          restartLabel={
            source === "screening"
              ? (screeningDone < screeningTotal ? "Next candidate" : "Back to shortlist")
              : "Start another interview"
          }
          />
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{value}/{max}</span>
      </div>
      <ScoreMeter value={value} max={max} size="sm" />
    </div>
  );
}

function Report({
  report,
  transcript,
  candidate,
  role,
  onRestart,
  restartLabel = "Start another interview",
}: {
  report: FinalReport;
  transcript: InterviewTurn[];
  candidate: string;
  role: string;
  onRestart: () => void;
  restartLabel?: string;
}) {
  const [showTranscript, setShowTranscript] = useState(false);

  function downloadPdf() {
    const DIM_LABELS: Record<string, string> = {
      technical_skills: "Technical skills", communication: "Communication",
      confidence: "Confidence", problem_solving: "Problem solving",
      analytical_thinking: "Analytical thinking", domain_expertise: "Domain expertise",
    };
    const dims = Object.entries(DIM_LABELS).map(([k, label]) => {
      const v = (report as any)[k] ?? 0;
      return `<div class="dim"><div class="dim-label"><span>${label}</span><span>${v}/10</span></div>
        <div class="bar"><div class="bar-fill" style="width:${(v/10)*100}%"></div></div></div>`;
    }).join("");
    const strengths = report.strengths.map((s) => `<li>${s}</li>`).join("") || "<li>None noted.</li>";
    const weaknesses = report.weaknesses.map((s) => `<li>${s}</li>`).join("") || "<li>None noted.</li>";
    const flags = report.flags?.length
      ? `<div class="flags"><h3>⚑ Integrity flags</h3><ul>${report.flags.map((f) => `<li>${f}</li>`).join("")}</ul></div>` : "";
    const txRows = transcript.map((t, i) => `
      <div class="turn">
        <p class="q-label">Q${i+1} · ${t.question.topic} <span class="badge">${t.question.difficulty}</span></p>
        <p class="q-text">${t.question.question}</p>
        <p class="ans">${t.answer || "(no answer given)"}</p>
        <p class="scores">Technical ${t.evaluation.technical_score}/10 &nbsp;
          Communication ${t.evaluation.communication_score}/10 &nbsp;
          Problem solving ${t.evaluation.problem_solving_score}/10 &nbsp;
          Analytical ${(t.evaluation.analytical_thinking_score??0)}/10 &nbsp;
          Domain ${(t.evaluation.domain_expertise_score??0)}/10</p>
      </div>`).join("");
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.documentElement.innerHTML = `<head><meta charset="utf-8">
      <title>Interview Report — ${candidate}</title>
      <style>
        body{font-family:system-ui,sans-serif;max-width:820px;margin:0 auto;padding:32px;color:#1a1a1a}
        h1{font-size:26px;font-weight:700;margin:0}h2{font-size:15px;font-weight:600;margin:16px 0 8px}
        .meta{color:#666;font-size:13px;margin-bottom:20px}
        .score-big{font-size:52px;font-weight:700;line-height:1}
        .rec{display:inline-block;padding:3px 12px;border-radius:999px;font-size:13px;font-weight:700;background:#E11A20;color:#fff;margin-left:12px}
        .bar{height:8px;background:#e5e7eb;border-radius:4px;margin-top:4px}
        .bar-fill{height:8px;background:#E11A20;border-radius:4px}
        .dim{margin:10px 0}.dim-label{display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}
        ul{margin:4px 0;padding-left:18px;font-size:13px;line-height:1.8}
        .flags{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:12px;margin-top:16px}
        .flags h3{margin:0 0 6px;font-size:13px;color:#92400e}
        .turn{border-top:1px solid #e5e7eb;padding:12px 0}
        .q-label{font-size:11px;font-weight:700;color:#E11A20;text-transform:uppercase;margin:0}
        .q-text{font-size:14px;font-weight:600;margin:4px 0}
        .ans{background:#f9fafb;padding:8px;border-radius:4px;font-size:13px;margin:6px 0;white-space:pre-wrap}
        .scores{font-size:11px;color:#6b7280;margin:0}.badge{background:#fee2e2;color:#991b1b;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600}
        .summary{font-size:13px;color:#444;line-height:1.6;margin-top:12px;padding:12px;background:#f9fafb;border-radius:6px}
        @media print{button{display:none!important}}
      </style></head><body>
      <h1>${candidate}</h1>
      <p class="meta">${role} · Interview Report</p>
      <div style="display:flex;align-items:baseline;gap:8px">
        <span class="score-big">${report.overall_score}</span>
        <span style="color:#666;font-size:14px">/100 overall</span>
        <span class="rec">${report.recommendation}</span>
      </div>
      ${report.summary ? `<p class="summary">${report.summary}</p>` : ""}
      <h2>Dimension scores</h2><div class="grid">${dims}</div>
      <div class="grid" style="margin-top:16px">
        <div><h2>Strengths</h2><ul>${strengths}</ul></div>
        <div><h2>Areas to probe</h2><ul>${weaknesses}</ul></div>
      </div>
      ${flags}
      <h2 style="margin-top:24px">Transcript (${transcript.length} questions)</h2>${txRows}
      <p style="margin-top:24px;text-align:center"><button onclick="window.print();window.close()" style="padding:8px 24px;background:#E11A20;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">Print / Save as PDF</button></p>
    </body></html>`;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SurfaceCard className="sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Interview report</p>
            <h2 className="mt-1 font-heading text-2xl font-bold tracking-tight">{candidate}</h2>
          </div>
          <StatusChip tone={hireTone(report.recommendation)} size="md" className="text-sm">
            {report.recommendation}
          </StatusChip>
        </div>

        <div className="mt-6 flex items-end gap-3">
          <span className="text-5xl font-bold tabular-nums text-foreground">{report.overall_score}</span>
          <span className="pb-2 text-sm text-muted-foreground">/ 100 overall</span>
        </div>
        <div className="mt-2">
          <ScoreMeter value={report.overall_score} size="lg" />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Bar label="Technical skills" value={report.technical_skills} />
          <Bar label="Communication" value={report.communication} />
          <Bar label="Confidence" value={report.confidence} />
          <Bar label="Problem solving" value={report.problem_solving} />
          <Bar label="Analytical thinking" value={report.analytical_thinking ?? 0} />
          <Bar label="Domain expertise" value={report.domain_expertise ?? 0} />
        </div>

        {report.summary && <p className="mt-6 text-sm leading-relaxed text-muted-foreground">{report.summary}</p>}

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Strengths</p>
            <ul className="space-y-1.5">
              {report.strengths.length ? report.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {s}
                </li>
              )) : <li className="text-sm text-muted-foreground">None noted.</li>}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Areas to probe</p>
            <ul className="space-y-1.5">
              {report.weaknesses.length ? report.weaknesses.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" /> {s}
                </li>
              )) : <li className="text-sm text-muted-foreground">None noted.</li>}
            </ul>
          </div>
        </div>

        {report.flags && report.flags.length > 0 && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
              <AlertTriangle className="size-4" /> Integrity flags
            </p>
            <ul className="space-y-1.5">
              {report.flags.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-700">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" /> {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SurfaceCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="lg" onClick={() => setShowTranscript((v) => !v)}>
          <FileText /> {showTranscript ? "Hide" : "Show"} transcript ({transcript.length})
        </Button>
        <Button variant="outline" size="lg" onClick={downloadPdf}>
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download PDF
        </Button>
        <Button variant="brand" size="lg" onClick={onRestart}>{restartLabel}</Button>
      </div>

      {showTranscript && (
        <div className="space-y-4">
          {transcript.map((t, i) => (
            <SurfaceCard key={i} pad="md">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Q{i + 1} · {t.question.topic}
              </p>
              <p className="mt-1 font-medium text-foreground">{t.question.question}</p>
              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm text-foreground">
                {t.answer || <span className="text-muted-foreground">No answer given.</span>}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Technical {t.evaluation.technical_score}/10</span>
                <span>Communication {t.evaluation.communication_score}/10</span>
                <span>Completeness {t.evaluation.completeness_score}/10</span>
                <span>Confidence {t.evaluation.confidence_score}/10</span>
                <span>Problem solving {t.evaluation.problem_solving_score}/10</span>
                <span>Analytical thinking {(t.evaluation.analytical_thinking_score ?? 0)}/10</span>
                <span>Domain expertise {(t.evaluation.domain_expertise_score ?? 0)}/10</span>
              </div>
              {t.evaluation.evidence && Object.keys(t.evaluation.evidence).length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer font-medium text-primary">Evidence</summary>
                  <ul className="mt-1.5 space-y-0.5 pl-2 text-muted-foreground">
                    {Object.entries(t.evaluation.evidence).map(([dim, quote]) => (
                      <li key={dim}>
                        <span className="font-medium capitalize text-foreground">{dim.replace(/_/g, " ")}</span>: "{quote}"
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {t.evaluation.suggested_answer && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-medium text-primary">Model answer</summary>
                  <p className="mt-2 leading-relaxed text-muted-foreground">{t.evaluation.suggested_answer}</p>
                </details>
              )}
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
