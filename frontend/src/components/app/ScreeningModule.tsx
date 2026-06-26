import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScanSearch, Download, RotateCcw, Eye, FileText,
  ChevronLeft, ChevronRight, X, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  Dropdown, PageHeader, Spinner, inputCls,
  SurfaceCard, SectionTitle, SegmentedControl, StatusChip, matchTone,
  ScoreMeter, StatTile, Banner, ErrorState, PhaseProgress,
} from "./ui";
import { ToastProvider, useToast } from "./toast";
import { UploadZone } from "./UploadZone";
import {
  screening, jd as jdApi, extractDocument,
  type JdRecord, type ScreeningResult, type ScreeningRun,
} from "@/lib/api";

/* ─── Constants ─────────────────────────────────────────────────────────── */
const SUPPORTED = [".pdf", ".docx", ".txt", ".md"];
const PER_PAGE = 10;

const STATUS: Record<string, string> = {
  extracting: "Reading files",
  embedding: "Shortlisting",
  extracting_requirements: "Parsing JD",
  evaluating: "Scoring candidates",
  complete: "Complete",
  error: "Error",
};
const STATUS_FULL: Record<string, string> = {
  extracting: "Reading files",
  embedding: "Shortlisting by similarity",
  extracting_requirements: "Extracting JD requirements",
  evaluating: "Scoring shortlisted candidates",
};
const STAGE_ORDER = ["extracting", "embedding", "extracting_requirements", "evaluating"] as const;
const STAGE_WEIGHTS = { extracting: 10, embedding: 20, extracting_requirements: 20, evaluating: 50 } as const;
const STAGES = STAGE_ORDER.map((s) => ({ key: s, label: STATUS[s] }));

/* ─── Utilities ─────────────────────────────────────────────────────────── */
function fileKey(f: File) { return `${f.name}::${f.size}`; }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function ScreeningModule() {
  return (
    <ToastProvider>
      <ScreeningInner />
    </ToastProvider>
  );
}

function ScreeningInner() {
  const { toast } = useToast();
  const [phase, setPhase] = useState<"setup" | "running" | "results">("setup");
  const [error, setError] = useState("");
  const [resumes, setResumes] = useState<File[]>([]);
  const [jdMode, setJdMode] = useState<"repo" | "upload">("repo");
  const [jds, setJds] = useState<JdRecord[]>([]);
  const [jdId, setJdId] = useState<number | "">("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [topK, setTopK] = useState(10);
  const [run, setRun] = useState<ScreeningRun | null>(null);

  const pollRef = useRef<number | undefined>(undefined);
  const genRef = useRef(0);

  useEffect(() => {
    jdApi.list().then(setJds).catch(() => setJds([]));
    return () => { genRef.current++; if (pollRef.current) window.clearTimeout(pollRef.current); };
  }, []);

  function processIncoming(incoming: File[]) {
    const keys = new Set(resumes.map(fileKey));
    const valid: File[] = [];
    const dupes: string[] = [];
    const invalid: string[] = [];

    for (const f of incoming) {
      if (!SUPPORTED.includes(fileExt(f.name))) { invalid.push(f.name); continue; }
      if (keys.has(fileKey(f))) { dupes.push(f.name); continue; }
      valid.push(f);
    }

    if (valid.length) {
      setResumes((prev) => [...prev, ...valid]);
      setError("");
      toast(`${valid.length} resume${valid.length === 1 ? "" : "s"} added.`, "success");
    }
    if (invalid.length) {
      toast(`${invalid.length} file${invalid.length === 1 ? " is" : "s are"} not a supported format (PDF, DOCX, TXT, MD) — skipped.`, "error");
    }
    if (dupes.length) {
      toast(`${dupes.length} duplicate${dupes.length === 1 ? "" : "s"} already in the list — skipped.`, "warn");
    }
    if (!valid.length && !invalid.length && !dupes.length) {
      toast("No supported files found in that selection.", "warn");
    }
  }

  function removeResume(idx: number) {
    setResumes((prev) => prev.filter((_, i) => i !== idx));
  }

  async function startRun() {
    setError("");
    if (!resumes.length) return setError("Add at least one resume before running.");
    if (resumes.length > 100) return setError(`Too many resumes (${resumes.length}). Screen up to 100 at a time.`);
    if (jdMode === "repo" && jdId === "") return setError("Choose a job description from the repository.");
    if (jdMode === "upload" && !jdFile) return setError("Upload a job description file.");
    try {
      const { run_id } = await screening.create({
        resumes, topK,
        jdId: jdMode === "repo" ? Number(jdId) : undefined,
        jdFiles: jdMode === "upload" && jdFile ? [jdFile] : undefined,
      });
      setRun(null); setPhase("running"); poll(run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the screening.");
    }
  }

  function poll(runId: string) {
    const myGen = ++genRef.current;
    const tick = async () => {
      if (myGen !== genRef.current) return;
      try {
        const r = await screening.get(runId);
        if (myGen !== genRef.current) return;
        setRun(r);
        if (r.status === "complete" || r.status === "error") { setPhase("results"); return; }
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
    setPhase("setup"); setRun(null); setResumes([]); setError("");
  }

  function runProgress(): number {
    if (!run) return 0;
    if (run.status === "complete") return 100;
    const idx = STAGE_ORDER.indexOf(run.status as typeof STAGE_ORDER[number]);
    if (idx < 0) return 0;
    const done = STAGE_ORDER.slice(0, idx).reduce((s, k) => s + STAGE_WEIGHTS[k], 0);
    if (run.status === "evaluating" && run.shortlisted > 0) {
      return done + (run.evaluated / run.shortlisted) * STAGE_WEIGHTS.evaluating;
    }
    return done + 5; // small bump to show the stage started
  }

  return (
    <div>
      <PageHeader
        icon={<ScanSearch className="size-6" />}
        eyebrow="CV Analyzer"
        title="Screen and rank candidates"
        description="Upload resumes and pick a job description. Semantic search shortlists the closest matches, then the model scores each shortlisted candidate in depth."
      />

      {error && <Banner tone="error" className="mb-6">{error}</Banner>}

      {/* ── Setup phase ── */}
      {phase === "setup" && (
        <div className="space-y-5">
          <UploadZone
            mode="both"
            variant="dropzone"
            accept={SUPPORTED}
            onFiles={processIncoming}
            title="Drag & drop resume files here"
            hint="Supports PDF, DOCX, TXT, and MD · up to 100 resumes per run"
            tip={<>Click <strong>Browse Folder</strong> multiple times to add resumes from different folders — each selection appends to the list below.</>}
          />

          {resumes.length > 0 && (
            <ResumeFileList files={resumes} onRemove={removeResume} onClear={() => setResumes([])} />
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {/* JD card */}
            <SurfaceCard pad="md" className="flex flex-col">
              <SectionTitle>Job description</SectionTitle>
              <SegmentedControl
                className="mb-4"
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
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  className={cn(inputCls, "file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm")}
                  onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
                />
              )}
            </SurfaceCard>

            {/* Settings + Run */}
            <SurfaceCard pad="md" className="flex flex-col">
              <SectionTitle>Screening settings</SectionTitle>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Candidates to score in depth</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className={inputCls}
                  value={topK}
                  onChange={(e) => setTopK(Math.max(1, Math.min(100, Number(e.target.value) || 10)))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  The closest matches by semantic similarity are shortlisted and scored by the model.
                </p>
              </label>
              <div className="mt-auto pt-5">
                <Button size="lg" onClick={startRun} disabled={!resumes.length} className="w-full">
                  <ScanSearch />
                  {resumes.length > 0
                    ? `Screen ${resumes.length} resume${resumes.length === 1 ? "" : "s"}`
                    : "Run screening"}
                </Button>
                {!resumes.length && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">Add resumes above to continue</p>
                )}
              </div>
            </SurfaceCard>
          </div>
        </div>
      )}

      {/* ── Running phase ── */}
      {phase === "running" && (
        <div className="mx-auto max-w-xl">
          <SurfaceCard className="p-8">
            <div className="mb-5 flex justify-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/15">
                <Spinner className="size-6 text-primary" />
              </div>
            </div>

            <p className="text-center text-lg font-bold text-foreground">
              {run ? (STATUS_FULL[run.status] ?? "Processing…") : "Starting…"}
            </p>
            <p className="mt-1.5 mb-6 text-center text-sm text-muted-foreground">
              {run?.status === "evaluating"
                ? `Scored ${run.evaluated} of ${run.shortlisted} shortlisted candidates`
                : run
                ? `${run.total} resume${run.total === 1 ? "" : "s"} in this batch`
                : "Preparing…"}
            </p>

            <PhaseProgress
              percent={runProgress()}
              stages={STAGES}
              currentKey={run?.status}
            />
          </SurfaceCard>
        </div>
      )}

      {/* ── Results phase ── */}
      {phase === "results" && run && <Results run={run} resumes={resumes} onReset={reset} />}
      {phase === "results" && !run && (
        <SurfaceCard>
          <ErrorState
            icon={<RotateCcw className="size-7" />}
            title="Run could not be loaded"
            description="It may have been cleared by a server restart."
            action={<Button variant="outline" size="lg" onClick={reset}><RotateCcw /> Start over</Button>}
          />
        </SurfaceCard>
      )}
    </div>
  );
}

/* ─── Selected-file list ─────────────────────────────────────────────────── */
function ResumeFileList({
  files, onRemove, onClear,
}: {
  files: File[];
  onRemove: (idx: number) => void;
  onClear: () => void;
}) {
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  function extBadge(name: string) {
    const ext = fileExt(name).slice(1).toUpperCase();
    if (ext === "PDF") return { label: ext, cls: "bg-red-50 text-red-600 ring-red-200" };
    if (ext === "DOCX" || ext === "DOC") return { label: ext, cls: "bg-blue-50 text-blue-600 ring-blue-200" };
    return { label: ext || "FILE", cls: "bg-muted text-muted-foreground ring-border" };
  }

  return (
    <SurfaceCard pad="none" className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/20 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="size-3.5 text-primary" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">
              {files.length} resume{files.length === 1 ? "" : "s"} selected
            </span>
            <span className="text-xs text-muted-foreground">{fmtSize(totalSize)} total</span>
          </div>
        </div>
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" /> Remove all
        </button>
      </div>

      {/* File rows */}
      <div className="max-h-64 overflow-y-auto">
        {files.map((f, i) => {
          const badge = extBadge(f.name);
          return (
            <div
              key={fileKey(f)}
              className="group flex items-center gap-3 border-b border-border/50 px-5 py-2.5 transition-colors last:border-0 hover:bg-muted/25"
            >
              <span className={cn("flex h-5 w-10 shrink-0 items-center justify-center rounded text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset", badge.cls)}>
                {badge.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={f.name}>{f.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtSize(f.size)}</span>
              <button
                onClick={() => onRemove(i)}
                aria-label={`Remove ${f.name}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/50 bg-muted/10 px-5 py-2.5">
        <span className="text-xs text-muted-foreground">
          Drag more files onto the zone above, or use the browse buttons to add from another folder.
        </span>
        <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
          {files.length} / 100
        </span>
      </div>
    </SurfaceCard>
  );
}

/* ─── Results ────────────────────────────────────────────────────────────── */
function Results({ run, resumes, onReset }: { run: ScreeningRun; resumes: File[]; onReset: () => void }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ScreeningResult | null>(null);

  const fileMap = useMemo(() => new Map(resumes.map((f) => [f.name, f])), [resumes]);
  const fileFor = (r: ScreeningResult | null) => (r ? fileMap.get(r.filename) : undefined);

  if (run.status === "error") {
    return (
      <SurfaceCard className="border-destructive/30 bg-destructive/10">
        <p className="font-semibold text-destructive">Screening failed</p>
        <p className="mt-1 text-sm text-destructive/90">{run.error || "Unknown error."}</p>
        <Button variant="outline" size="lg" className="mt-4" onClick={onReset}><RotateCcw /> Start over</Button>
      </SurfaceCard>
    );
  }

  const total = run.results.length;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PER_PAGE;
  const pageRows = run.results.slice(start, start + PER_PAGE);

  const scored = run.results.filter((r) => r.overall_score != null);
  const strong = run.results.filter((r) => r.recommendation === "Strong Match").length;
  const avg = scored.length
    ? Math.round(scored.reduce((s, r) => s + (r.overall_score || 0), 0) / scored.length)
    : null;

  function preview(r: ScreeningResult) {
    const file = fileMap.get(r.filename);
    if (!file) { setSelected(r); return; }
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const url = URL.createObjectURL(file);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      setSelected(r);
    }
  }

  function dl(r: ScreeningResult) {
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
          <a
            href={screening.reportUrl(run.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <Download className="size-4" /> Export Excel
          </a>
          <Button variant="outline" size="lg" onClick={onReset}><RotateCcw /> New run</Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Resumes" value={run.total} />
        <StatTile label="Shortlisted" value={run.shortlisted} />
        <StatTile label="Strong matches" value={strong} accent="text-emerald-600" />
        <StatTile label="Avg score" value={avg != null ? avg : "—"} />
      </div>

      {run.file_errors?.length > 0 && (
        <Banner tone="warn" className="mb-4">
          {run.file_errors.length} file{run.file_errors.length === 1 ? "" : "s"} skipped:{" "}
          {run.file_errors.map((e) => e.filename).join(", ")}
        </Banner>
      )}

      <SurfaceCard pad="none" className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_8rem_8.5rem] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>#</span><span>Candidate</span><span>Match score</span>
            <span>Recommendation</span><span className="text-right">Actions</span>
          </div>
          {pageRows.map((r, i) => (
            <ResultRow
              key={`${start + i}-${r.filename}`}
              rank={start + i + 1}
              r={r}
              hasFile={fileMap.has(r.filename)}
              onView={() => setSelected(r)}
              onPreview={() => preview(r)}
              onDownload={() => dl(r)}
            />
          ))}
          {total === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No results.</p>}
        </div>
      </SurfaceCard>

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
          {selected && <CandidateDetails r={selected} file={fileFor(selected)} onDownload={() => dl(selected)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ─── Result row ─────────────────────────────────────────────────────────── */
function ResultRow({
  rank, r, hasFile, onView, onPreview, onDownload,
}: {
  rank: number; r: ScreeningResult; hasFile: boolean;
  onView: () => void; onPreview: () => void; onDownload: () => void;
}) {
  const score = r.overall_score;
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_8rem_8.5rem] items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-muted/30">
      <span className={cn(
        "flex size-6 items-center justify-center rounded-md text-xs font-bold tabular-nums",
        rank === 1 ? "bg-primary text-white" : "bg-muted text-muted-foreground",
      )}>
        {rank}
      </span>
      <button onClick={onView} className="min-w-0 text-left">
        <span className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary">
          {r.candidate_name || r.filename}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{r.filename}</span>
      </button>
      <span>
        {score != null
          ? <ScoreMeter value={score} size="sm" showValue />
          : <span className="text-xs text-muted-foreground">—</span>}
      </span>
      <span>
        <StatusChip tone={matchTone(r.recommendation)} size="sm">{r.recommendation || "Pending"}</StatusChip>
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

/* ─── Candidate detail drawer ────────────────────────────────────────────── */
function CandidateDetails({ r, file, onDownload }: { r: ScreeningResult; file?: File; onDownload: () => void }) {
  const score = r.overall_score;
  const skillsMatched = [...(r.required_skills_matched ?? []), ...(r.preferred_skills_matched ?? [])];
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-5 pr-12">
        <SheetTitle className="truncate text-lg font-bold">{r.candidate_name || r.filename}</SheetTitle>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.filename}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <StatusChip tone={matchTone(r.recommendation)}>{r.recommendation || "Pending"}</StatusChip>
          {score != null && (
            <span className="text-sm font-bold tabular-nums text-foreground">
              {Math.round(score)}<span className="font-normal text-muted-foreground">/100</span>
            </span>
          )}
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
              <ScoreMeter value={score} size="lg" className="flex-1" />
              <span className="text-lg font-bold tabular-nums text-foreground">
                {Math.round(score)}<span className="text-sm font-normal text-muted-foreground">/100</span>
              </span>
            </div>
          </section>
        )}

        {r.error && <Banner tone="error">{r.error}</Banner>}
        {!r.shortlisted && !r.error && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            This candidate was outside the scored shortlist.
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
          {!file && (
            <p className="mt-1.5 text-center text-xs text-muted-foreground">
              File available only during the session it was uploaded.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Resume preview (in drawer) ────────────────────────────────────────── */
function ResumePreview({ file }: { file?: File }) {
  const [text, setText] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isPdf = !!file && file.name.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    setText(null); setUrl(null);
    if (!file) return;
    if (isPdf) {
      const u = URL.createObjectURL(file);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    let cancelled = false;
    setLoading(true);
    extractDocument(file)
      .then((r) => { if (!cancelled) setText(r.text?.trim() || "No readable text found."); })
      .catch(() => { if (!cancelled) setText("This file could not be read for preview."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, isPdf]);

  if (!file) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 text-center text-sm text-muted-foreground">
        File available only during the session it was uploaded.
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

/* ─── Small presentational helpers ──────────────────────────────────────── */
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
