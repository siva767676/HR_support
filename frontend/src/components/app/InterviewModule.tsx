import { useEffect, useRef, useState } from "react";
import { Bot, ArrowRight, Check, FileText, Upload, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dropdown, Field, PageHeader, Spinner, inputCls,
  SurfaceCard, SectionTitle, SegmentedControl, StatusChip, hireTone, ScoreMeter,
  Banner, PhaseProgress,
} from "./ui";
import { UploadZone } from "./UploadZone";
import {
  interview,
  jd as jdApi,
  extractDocument,
  type FinalReport,
  type InterviewTurn,
  type JdRecord,
  type PlannedQuestion,
} from "@/lib/api";

type Phase = "setup" | "running" | "done";

const LEVELS = [
  { value: "entry", label: "Entry level" },
  { value: "mid", label: "Mid level" },
  { value: "senior", label: "Senior" },
];

export default function InterviewModule() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState("");

  // setup state
  const [candidate, setCandidate] = useState("");
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("mid");
  const [maxQ, setMaxQ] = useState(5);
  const [jds, setJds] = useState<JdRecord[]>([]);
  const [jdMode, setJdMode] = useState<"repo" | "upload">("repo");
  const [jdId, setJdId] = useState<number | "">("");
  const [jdText, setJdText] = useState("");
  const [jdFile, setJdFile] = useState("");
  const [jdExtracting, setJdExtracting] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [starting, setStarting] = useState(false);

  // running state
  const [threadId, setThreadId] = useState("");
  const [question, setQuestion] = useState<PlannedQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [asked, setAsked] = useState(0); // questions presented so far
  const [total, setTotal] = useState(0); // questions the model actually planned
  const [transcript, setTranscript] = useState<InterviewTurn[]>([]);

  // done state
  const [report, setReport] = useState<FinalReport | null>(null);

  const answerRef = useRef<HTMLTextAreaElement>(null);
  // Web Speech API recognizer (browser STT); typed loosely as it is not in lib.dom for all targets.
  const recognitionRef = useRef<any>(null);
  const baseAnswerRef = useRef("");

  useEffect(() => {
    jdApi
      .list()
      .then(setJds)
      .catch(() => setJds([]));
  }, []);

  // Detect browser speech-to-text support; abort any live recognizer on unmount.
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(!!SR);
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
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
    const jobDescription = resolvedJd();
    if (!role.trim()) return setError("Enter the role you are interviewing for.");
    if (!jobDescription) return setError("Select a saved JD or upload a JD file.");
    if (!resumeText.trim()) return setError("Upload the candidate's resume.");
    setStarting(true);
    try {
      const res = await interview.start({
        candidate_name: candidate.trim() || "Candidate",
        role: role.trim(),
        experience_level: level,
        resume_text: resumeText.trim(),
        job_description: jobDescription,
        max_questions: maxQ,
      });
      setThreadId(res.thread_id);
      setQuestion(res.question);
      setAsked(1);
      setTotal(res.total_questions || maxQ);
      setTranscript([]);
      setAnswer("");
      setReport(null);
      setPhase("running");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the interview.");
    } finally {
      setStarting(false);
    }
  }

  function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop(); // onend flips `recording` off
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSpeechSupported(false);
      return;
    }
    setError("");
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    // Append the transcript after whatever is already in the box (supports multiple takes).
    baseAnswerRef.current = answer ? answer.trimEnd() + " " : "";
    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setAnswer(baseAnswerRef.current + transcript);
    };
    rec.onerror = (e: any) => {
      setRecording(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access was blocked. Allow mic permission; voice input needs HTTPS or localhost.");
      } else if (e.error !== "aborted" && e.error !== "no-speech") {
        setError(`Voice input error: ${e.error}`);
      }
    };
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setRecording(true);
    } catch {
      /* start() throws if already running; ignore */
    }
  }

  async function submitAnswer() {
    if (!answer.trim() || submitting) return;
    // Detach and abort any recognizer so a trailing transcript can't bleed into
    // the next question's answer box.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    if (recording) setRecording(false);
    setError("");
    setSubmitting(true);
    try {
      const res = await interview.answer(threadId, answer.trim());
      setTranscript(res.transcript);
      setAnswer("");
      if (res.done && res.report) {
        setReport(res.report);
        setQuestion(null);
        setPhase("done");
      } else if (res.question) {
        setQuestion(res.question);
        setAsked((n) => n + 1);
        answerRef.current?.focus();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not submit the answer.";
      setError(msg);
      // 409 = the in-memory session was lost (server restart). Drop back to setup
      // with the inputs intact so the user can restart immediately.
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
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    setRecording(false);
    setPhase("setup");
    setThreadId("");
    setQuestion(null);
    setAnswer("");
    setTranscript([]);
    setReport(null);
    setAsked(0);
    setTotal(0);
    setError("");
  }

  return (
    <div>
      <PageHeader
        icon={<Bot className="size-6" />}
        eyebrow="AI Interview"
        title="AI Interview Assistant"
        description="Plan a tailored interview from a role, its job description, and the candidate's resume. MEDHA asks one question at a time, scores each answer, and produces a hiring report. Nothing is stored: the session lives in memory only."
      />

      {error && <Banner tone="error" className="mb-6">{error}</Banner>}

      {phase === "setup" && (
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
                  min={1}
                  max={12}
                  className={inputCls}
                  value={maxQ}
                  onChange={(e) => setMaxQ(Math.max(1, Math.min(12, Number(e.target.value) || 5)))}
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
              <Button size="lg" onClick={startInterview} disabled={starting || extracting || jdExtracting} className="w-full">
                {starting ? <><Spinner /> Planning the interview…</> : <>Start interview <ArrowRight /></>}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                The model designs {maxQ} question{maxQ === 1 ? "" : "s"} from the resume and JD. This can take a few seconds.
              </p>
            </div>
          </SurfaceCard>
        </div>
      )}

      {phase === "running" && question && (
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                {question.round}
              </span>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium capitalize text-primary">
                {question.difficulty}
              </span>
            </div>
            <button onClick={reset} className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Start over
            </button>
          </div>

          <PhaseProgress
            percent={(asked / Math.max(total, 1)) * 100}
            caption={`Question ${asked} of ${total}`}
          />

          <SurfaceCard className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{question.topic}</p>
            <p className="mt-2 text-lg font-medium leading-relaxed text-foreground">{question.question}</p>
          </SurfaceCard>

          <div className="mt-4">
            <div className="relative">
              <textarea
                ref={answerRef}
                autoFocus
                className={cn(inputCls, "min-h-40 resize-y", recording && "border-primary ring-3 ring-primary/20")}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={recording ? "Listening… speak the answer" : "Record the answer with the mic, or type it"}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitAnswer();
                }}
              />
              {recording && (
                <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  <span className="size-2 animate-pulse rounded-full bg-primary" /> Listening
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {speechSupported && (
                  <Button type="button" variant={recording ? "default" : "outline"} size="lg" onClick={toggleRecording}>
                    {recording ? <><Square /> Stop recording</> : <><Mic /> Record answer</>}
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {recording ? "Click stop when finished" : "Ctrl or Cmd + Enter to submit"}
                </span>
              </div>
              <Button size="lg" onClick={submitAnswer} disabled={submitting || !answer.trim()}>
                {submitting ? (
                  <><Spinner /> {asked >= total ? "Scoring and writing report…" : "Scoring answer…"}</>
                ) : (
                  <>{asked >= total ? "Finish and get report" : "Submit answer"} <ArrowRight /></>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === "done" && report && (
        <Report report={report} transcript={transcript} candidate={candidate.trim() || "Candidate"} onRestart={reset} />
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
  onRestart,
}: {
  report: FinalReport;
  transcript: InterviewTurn[];
  candidate: string;
  onRestart: () => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SurfaceCard className="sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Interview report</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">{candidate}</h2>
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

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Bar label="Technical skills" value={report.technical_skills} />
          <Bar label="Communication" value={report.communication} />
          <Bar label="Confidence" value={report.confidence} />
          <Bar label="Problem solving" value={report.problem_solving} />
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
      </SurfaceCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="lg" onClick={() => setShowTranscript((v) => !v)}>
          <FileText /> {showTranscript ? "Hide" : "Show"} transcript ({transcript.length})
        </Button>
        <Button size="lg" onClick={onRestart}>Start another interview</Button>
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
              </div>
              {t.evaluation.suggested_answer && (
                <details className="mt-3 text-sm">
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
