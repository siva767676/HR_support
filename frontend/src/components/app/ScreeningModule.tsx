import { useEffect, useMemo, useRef, useState } from "react";
import { ScanSearch, Download, FolderOpen, RotateCcw, Eye, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Dropdown, PageHeader, Spinner, inputCls } from "./ui";
import { screening, jd as jdApi, extractDocument, type JdRecord, type ScreeningResult, type ScreeningRun } from "@/lib/api";

const SUPPORTED = [".pdf", ".docx", ".txt", ".md"];
const PER_PAGE = 10;

const STATUS: Record<string, string> = {
  extracting: "Reading files",
  embedding: "Shortlisting by similarity",
  extracting_requirements: "Extracting JD requirements",
  evaluating: "Scoring shortlisted candidates",
  complete: "Complete",
  error: "Error",
};

function recTone(rec: string | null) {
  if (rec === "Strong Match") return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (rec === "Good Match") return "bg-amber-50 text-amber-700 ring-amber-600/20";
  if (rec === "Weak Match") return "bg-destructive/5 text-destructive/80 ring-destructive/15";
  if (rec === "Evaluation failed") return "bg-destructive/10 text-destructive ring-destructive/20";
  return "bg-muted text-muted-foreground ring-border";
}

function scoreColor(score: number) {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 55) return "bg-amber-500";
  return "bg-chart-3";
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function ScreeningModule() {
  const [phase, setPhase] = useState<"setup" | "running" | "results">("setup");
  const [error, setError] = useState("");

  const [resumes, setResumes] = useState<File[]>([]);
  const [jdMode, setJdMode] = useState<"repo" | "upload">("repo");
  const [jds, setJds] = useState<JdRecord[]>([]);
  const [jdId, setJdId] = useState<number | "">("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [topK, setTopK] = useState(20);

  const [run, setRun] = useState<ScreeningRun | null>(null);

  const folderRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | undefined>(undefined);
  const genRef = useRef(0); // bumped on reset/unmount to cancel an in-flight poll

  useEffect(() => {
    // webkitdirectory has no typed prop; set it directly for folder selection (Chrome/Edge).
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);
  useEffect(() => {
    jdApi.list().then(setJds).catch(() => setJds([]));
    return () => { genRef.current++; if (pollRef.current) window.clearTimeout(pollRef.current); };
  }, []);

  function pickFolder(files: FileList | null) {
    const arr = Array.from(files ?? []).filter((f) => SUPPORTED.some((ext) => f.name.toLowerCase().endsWith(ext)));
    setResumes(arr);
    if (!arr.length) setError("That folder has no PDF, DOCX, TXT, or MD files.");
    else setError("");
  }

  async function startRun() {
    setError("");
    if (!resumes.length) return setError("Choose a folder containing resumes (PDF, DOCX, TXT, MD).");
    if (resumes.length > 100) return setError(`Too many resumes (${resumes.length}). Screen up to 100 at a time.`);
    if (jdMode === "repo" && jdId === "") return setError("Choose a job description from the repository.");
    if (jdMode === "upload" && !jdFile) return setError("Upload a job description file.");
    try {
      const { run_id } = await screening.create({
        resumes,
        topK,
        jdId: jdMode === "repo" ? Number(jdId) : undefined,
        jdFiles: jdMode === "upload" && jdFile ? [jdFile] : undefined,
      });
      setRun(null);
      setPhase("running");
      poll(run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the screening.");
    }
  }

  function poll(runId: string) {
    const myGen = ++genRef.current; // this poll owns the latest generation
    const tick = async () => {
      if (myGen !== genRef.current) return; // superseded by reset/unmount/new run
      try {
        const r = await screening.get(runId);
        if (myGen !== genRef.current) return; // cancelled during the request
        setRun(r);
        if (r.status === "complete" || r.status === "error") {
          setPhase("results");
          return;
        }
        pollRef.current = window.setTimeout(tick, 2000);
      } catch (e) {
        if (myGen !== genRef.current) return;
        setError(e instanceof Error ? e.message : "Lost contact with the screening run.");
        setPhase("results");
      }
    };
    tick();
  }

  function reset() {
    genRef.current++;
    if (pollRef.current) window.clearTimeout(pollRef.current);
    setPhase("setup");
    setRun(null);
    setResumes([]);
    setError("");
  }

  return (
    <div>
      <PageHeader
        icon={<ScanSearch className="size-6" />}
        eyebrow="CV Analyzer"
        title="Screen and rank candidates"
        description="Upload a folder of resumes and pick a job description. A semantic shortlist narrows the field, then the model scores each shortlisted candidate and ranks them by fit."
      />

      {error && <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {phase === "setup" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div>
              <p className="mb-1.5 text-sm font-medium text-foreground">Resumes folder</p>
              <button
                onClick={() => folderRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                <FolderOpen className="size-7 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  {resumes.length ? `${resumes.length} resume${resumes.length === 1 ? "" : "s"} selected` : "Choose a folder"}
                </span>
                <span className="text-xs text-muted-foreground">PDF, DOCX, TXT, or MD · up to 100 per run</span>
              </button>
              <input ref={folderRef} type="file" multiple className="hidden" onChange={(e) => pickFolder(e.target.files)} />
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-foreground">Top candidates to score</p>
              <input
                type="number"
                min={1}
                max={100}
                className={inputCls}
                value={topK}
                onChange={(e) => setTopK(Math.max(1, Math.min(100, Number(e.target.value) || 20)))}
              />
              <p className="mt-1 text-xs text-muted-foreground">The closest matches by similarity are scored in depth.</p>
            </div>
          </div>

          <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
            <p className="mb-1.5 text-sm font-medium text-foreground">Job description</p>
            <div className="mb-4 inline-flex w-fit rounded-lg border border-border bg-background p-1">
              {(["repo", "upload"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setJdMode(m)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                    jdMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "repo" ? "From repository" : "Upload file"}
                </button>
              ))}
            </div>

            {jdMode === "repo" ? (
              <Dropdown
                value={jdId === "" ? "" : String(jdId)}
                onChange={(v) => setJdId(v === "" ? "" : Number(v))}
                options={jds.map((j) => ({ value: String(j.id), label: j.title }))}
                placeholder="Select a saved JD…"
              />
            ) : (
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className={cn(inputCls, "file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm")}
                onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
              />
            )}

            <div className="mt-auto pt-6">
              <Button size="lg" onClick={startRun} className="w-full">
                <ScanSearch /> Run screening
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === "running" && (
        <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <Spinner className="mx-auto mb-4 size-8 text-primary" />
          <p className="text-lg font-semibold text-foreground">{run ? STATUS[run.status] : "Starting…"}</p>
          {run && (
            <p className="mt-2 text-sm text-muted-foreground">
              {run.status === "evaluating"
                ? `Scored ${run.evaluated} of ${run.shortlisted} shortlisted (${run.total} resumes total).`
                : `${run.total} resume${run.total === 1 ? "" : "s"} in this run.`}
            </p>
          )}
        </div>
      )}

      {phase === "results" && run && <Results run={run} resumes={resumes} onReset={reset} />}

      {phase === "results" && !run && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">
            The screening run could not be loaded. It may have been cleared by a server restart.
          </p>
          <Button variant="outline" size="lg" className="mt-4" onClick={reset}><RotateCcw /> Start over</Button>
        </div>
      )}
    </div>
  );
}

function Results({ run, resumes, onReset }: { run: ScreeningRun; resumes: File[]; onReset: () => void }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ScreeningResult | null>(null);

  const fileMap = useMemo(() => new Map(resumes.map((f) => [f.name, f])), [resumes]);
  const fileFor = (r: ScreeningResult | null) => (r ? fileMap.get(r.filename) : undefined);

  if (run.status === "error") {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6">
        <p className="font-semibold text-destructive">Screening failed</p>
        <p className="mt-1 text-sm text-destructive/90">{run.error || "Unknown error."}</p>
        <Button variant="outline" size="lg" className="mt-4" onClick={onReset}><RotateCcw /> Start over</Button>
      </div>
    );
  }

  const total = run.results.length;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PER_PAGE;
  const pageRows = run.results.slice(start, start + PER_PAGE);

  const scored = run.results.filter((r) => r.overall_score != null);
  const strong = run.results.filter((r) => r.recommendation === "Strong Match").length;
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + (r.overall_score || 0), 0) / scored.length) : null;

  function preview(r: ScreeningResult) {
    const file = fileMap.get(r.filename);
    if (!file) { setSelected(r); return; }
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const url = URL.createObjectURL(file);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      setSelected(r); // drawer shows an extracted-text preview for non-PDF
    }
  }

  function download(r: ScreeningResult) {
    const file = fileMap.get(r.filename);
    if (file) downloadFile(file);
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Results</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {run.jd_name} · {run.shortlisted} shortlisted of {run.total} resumes
          </p>
        </div>
        <div className="flex gap-2">
          <a href={screening.reportUrl(run.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"><Download className="size-4" /> Export Excel</a>
          <Button variant="outline" size="lg" onClick={onReset}><RotateCcw /> New run</Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Resumes" value={run.total} />
        <Stat label="Shortlisted" value={run.shortlisted} />
        <Stat label="Strong matches" value={strong} accent="text-emerald-600" />
        <Stat label="Avg score" value={avg != null ? avg : "—"} />
      </div>

      {run.file_errors?.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-600/30 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {run.file_errors.length} file{run.file_errors.length === 1 ? "" : "s"} skipped: {run.file_errors.map((e) => e.filename).join(", ")}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_8rem_8.5rem] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>#</span>
            <span>Candidate</span>
            <span>Match score</span>
            <span>Recommendation</span>
            <span className="text-right">Actions</span>
          </div>
          {pageRows.map((r, i) => (
            <ResultRow
              key={`${start + i}-${r.filename}`}
              rank={start + i + 1}
              r={r}
              hasFile={fileMap.has(r.filename)}
              onView={() => setSelected(r)}
              onPreview={() => preview(r)}
              onDownload={() => download(r)}
            />
          ))}
          {total === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No results.</p>}
        </div>
      </div>

      {pageCount > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Showing {start + 1}–{Math.min(start + PER_PAGE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft /> Previous
            </Button>
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={cn(
                  "size-8 rounded-md text-sm font-medium tabular-nums transition-colors",
                  i === safePage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {i + 1}
              </button>
            ))}
            <Button variant="outline" size="sm" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="w-full gap-0 p-0"
          style={{ maxWidth: "min(46rem, 96vw)" }}
        >
          {selected && <CandidateDetails r={selected} file={fileFor(selected)} onDownload={() => download(selected)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ResultRow({
  rank,
  r,
  hasFile,
  onView,
  onPreview,
  onDownload,
}: {
  rank: number;
  r: ScreeningResult;
  hasFile: boolean;
  onView: () => void;
  onPreview: () => void;
  onDownload: () => void;
}) {
  const score = r.overall_score;
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_8rem_8.5rem] items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-muted/30">
      <span className={cn("flex size-6 items-center justify-center rounded-md text-xs font-bold tabular-nums", rank === 1 ? "bg-primary text-white" : "bg-muted text-muted-foreground")}>{rank}</span>
      <button onClick={onView} className="min-w-0 text-left">
        <span className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary">{r.candidate_name || r.filename}</span>
        <span className="block truncate text-xs text-muted-foreground">{r.filename}</span>
      </button>
      <span>
        {score != null ? (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
              <span className={cn("block h-full rounded-full", scoreColor(score))} style={{ width: `${score}%` }} />
            </span>
            <span className="text-sm font-bold tabular-nums text-foreground">{Math.round(score)}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </span>
      <span>
        <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", recTone(r.recommendation))}>
          {r.recommendation || "Pending"}
        </span>
      </span>
      <span className="flex items-center justify-end gap-0.5">
        <Button variant="ghost" size="icon-sm" title="View details" aria-label="View details" onClick={onView}><Eye /></Button>
        <Button variant="ghost" size="icon-sm" title="Preview resume" aria-label="Preview resume" disabled={!hasFile} onClick={onPreview}><FileText /></Button>
        {r.shortlisted && (
          <Button variant="ghost" size="icon-sm" title="Download resume" aria-label="Download resume" disabled={!hasFile} onClick={onDownload}><Download /></Button>
        )}
      </span>
    </div>
  );
}

function CandidateDetails({ r, file, onDownload }: { r: ScreeningResult; file?: File; onDownload: () => void }) {
  const score = r.overall_score;
  const skillsMatched = [...(r.required_skills_matched ?? []), ...(r.preferred_skills_matched ?? [])];
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-5 pr-12">
        <SheetTitle className="truncate text-lg font-bold">{r.candidate_name || r.filename}</SheetTitle>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.filename}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", recTone(r.recommendation))}>
            {r.recommendation || "Pending"}
          </span>
          {score != null && <span className="text-sm font-bold tabular-nums text-foreground">{Math.round(score)}<span className="font-normal text-muted-foreground">/100</span></span>}
          {r.candidate_email && <span className="truncate text-xs text-muted-foreground">{r.candidate_email}</span>}
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <section>
          <SectionTitle>Resume preview</SectionTitle>
          <ResumePreview file={file} />
        </section>

        {score != null && (
          <section>
            <SectionTitle>Match score</SectionTitle>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", scoreColor(score))} style={{ width: `${score}%` }} />
              </div>
              <span className="text-lg font-bold tabular-nums text-foreground">{Math.round(score)}<span className="text-sm font-normal text-muted-foreground">/100</span></span>
            </div>
          </section>
        )}

        {r.error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{r.error}</p>}
        {!r.shortlisted && !r.error && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            This candidate was outside the scored shortlist, so only the resume is available.
          </p>
        )}

        {r.summary && (
          <section>
            <SectionTitle>Selection reasons</SectionTitle>
            <p className="text-sm leading-relaxed text-muted-foreground">{r.summary}</p>
          </section>
        )}

        <BulletList title="Strengths" items={r.strengths} dot="bg-emerald-500" />

        {skillsMatched.length > 0 && (
          <section>
            <SectionTitle>Skill match analysis</SectionTitle>
            <Chips items={skillsMatched} tone="bg-emerald-50 text-emerald-700 ring-emerald-600/20" />
          </section>
        )}

        {(r.required_skills_missing?.length ?? 0) > 0 && (
          <section>
            <SectionTitle>Missing skills</SectionTitle>
            <Chips items={r.required_skills_missing ?? []} tone="bg-destructive/5 text-destructive/90 ring-destructive/20" />
          </section>
        )}

        <BulletList title="Gaps" items={r.missing_requirements} dot="bg-amber-500" />
        <BulletList title="Experience" items={r.experience} dot="bg-muted-foreground" />
        <BulletList title="Education" items={r.education} dot="bg-muted-foreground" />
        <BulletList title="Projects" items={r.projects} dot="bg-muted-foreground" />
        <BulletList title="Certifications" items={r.certifications} dot="bg-muted-foreground" />
        <BulletList title="Achievements" items={r.achievements} dot="bg-muted-foreground" />
      </div>

      {r.shortlisted && (
        <div className="border-t border-border p-4">
          <Button size="lg" className="w-full" disabled={!file} onClick={onDownload}>
            <Download /> Download resume
          </Button>
          {!file && <p className="mt-1.5 text-center text-xs text-muted-foreground">The file is available only during the session it was uploaded.</p>}
        </div>
      )}
    </div>
  );
}

function ResumePreview({ file }: { file?: File }) {
  const [text, setText] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isPdf = !!file && file.name.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    setText(null);
    setUrl(null);
    if (!file) return;
    if (isPdf) {
      const u = URL.createObjectURL(file);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    let cancelled = false;
    setLoading(true);
    extractDocument(file)
      .then((r) => { if (!cancelled) setText(r.text?.trim() || "No readable text was found in this file."); })
      .catch(() => { if (!cancelled) setText("This file could not be read for preview."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, isPdf]);

  if (!file) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 text-center text-sm text-muted-foreground">
        The resume file is available only during the session it was uploaded.
      </div>
    );
  }
  if (isPdf && url) {
    return <iframe title="Resume preview" src={url} className="h-[58vh] w-full rounded-lg border border-border bg-white" />;
  }
  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground">
        <Spinner /> Reading {file.name}…
      </div>
    );
  }
  return (
    <pre className="max-h-[58vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 font-sans text-xs leading-relaxed text-foreground">
      {text}
    </pre>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums text-foreground", accent)}>{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function Chips({ items, tone }: { items: string[]; tone: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s, i) => (
        <span key={i} className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", tone)}>{s}</span>
      ))}
    </div>
  );
}

function BulletList({ title, items, dot }: { title: string; items?: string[]; dot: string }) {
  if (!items || items.length === 0) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-foreground">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dot)} /> {it}
          </li>
        ))}
      </ul>
    </section>
  );
}
