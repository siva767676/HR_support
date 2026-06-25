import { useEffect, useState } from "react";
import { FileText, Search, Download, Trash2, Sparkles, Save, ArrowRight, Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Markdown from "./Markdown";
import { jd as jdApi, type JdFields, type JdRecord } from "@/lib/api";

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

const inputErrCls =
  "w-full rounded-lg border border-destructive bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-destructive focus-visible:ring-3 focus-visible:ring-destructive/30";

function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-hidden="true" />;
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </label>
  );
}

const EMPTY: JdFields = {
  title: "",
  location: "",
  reporting: "",
  experience: "",
  skills: "",
  responsibilities: "",
  requirements: "",
};

type FieldErrors = Partial<{
  title: string;
  skills: string;
  responsibilities: string;
  expMin: string;
  expMax: string;
}>;

export default function JdModule() {
  const [tab, setTab] = useState<"generate" | "repository">("generate");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // generate
  const [fields, setFields] = useState<JdFields>(EMPTY);
  const [expMin, setExpMin] = useState("");
  const [expMax, setExpMax] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  // repository
  const [search, setSearch] = useState("");
  const [jds, setJds] = useState<JdRecord[]>([]);
  const [selected, setSelected] = useState<JdRecord | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const set = (k: keyof JdFields, v: string) => setFields((f) => ({ ...f, [k]: v }));

  // Sync experience string from min/max whenever they change
  useEffect(() => {
    const min = expMin.trim();
    const max = expMax.trim();
    if (min && max) set("experience", `${min} to ${max} years`);
    else if (min) set("experience", `${min}+ years`);
    else if (max) set("experience", `Up to ${max} years`);
    else set("experience", "");
  }, [expMin, expMax]);

  async function loadList(q = "") {
    setLoadingList(true);
    try {
      setJds(await jdApi.list(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the repository.");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (tab !== "repository") return;
    const t = setTimeout(() => loadList(search), 250);
    return () => clearTimeout(t);
  }, [tab, search]);

  function validateFields(): boolean {
    const errs: FieldErrors = {};

    if (!fields.title.trim()) {
      errs.title = "Job title is required.";
    } else if (fields.title.trim().length < 2) {
      errs.title = "Job title must be at least 2 characters.";
    }

    if (!fields.skills?.trim()) {
      errs.skills = "At least one required skill is needed.";
    }

    if (!fields.responsibilities?.trim()) {
      errs.responsibilities = "Key responsibilities are required to generate a meaningful JD.";
    }

    if (expMin !== "") {
      const min = Number(expMin);
      if (!Number.isFinite(min) || min < 0 || min > 50) {
        errs.expMin = "Enter a value between 0 and 50.";
      }
    }
    if (expMax !== "") {
      const max = Number(expMax);
      if (!Number.isFinite(max) || max < 0 || max > 50) {
        errs.expMax = "Enter a value between 0 and 50.";
      }
    }
    if (expMin !== "" && expMax !== "" && !errs.expMin && !errs.expMax) {
      if (Number(expMin) > Number(expMax)) {
        errs.expMax = "Max must be greater than or equal to min.";
      }
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function generate() {
    setError("");
    setNotice("");
    if (!validateFields()) return;
    setGenerating(true);
    setEditing(false);
    try {
      const res = await jdApi.generate(fields);
      setBody(res.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "JD generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    setError("");
    if (!body.trim()) return setError("Generate or write a JD body first.");
    setSaving(true);
    try {
      const rec = await jdApi.create(fields, body);
      setNotice(`Saved "${rec.title}" to the repository.`);
      setBody("");
      setFields(EMPTY);
      setExpMin("");
      setExpMax("");
      setFieldErrors({});
      setEditing(false);
      await loadList();
      setSelected(rec);
      setTab("repository");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the JD.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(rec: JdRecord) {
    if (!confirm(`Delete "${rec.title}" from the repository?`)) return;
    try {
      await jdApi.remove(rec.id);
      if (selected?.id === rec.id) setSelected(null);
      await loadList(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the JD.");
    }
  }

  // Clamp numeric experience input to 0–50
  function handleExpInput(val: string, setter: (v: string) => void) {
    if (val === "") { setter(""); return; }
    const n = parseInt(val, 10);
    if (isNaN(n)) return;
    setter(String(Math.min(50, Math.max(0, n))));
  }

  return (
    <div>
      <header className="mb-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <FileText className="size-4" /> JD Generation
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Job Descriptions</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Turn a few inputs into a complete JD in the company standard template, then save it to the
          repository to reuse in screening and interviews.
        </p>
      </header>

      <div className="mb-6 inline-flex rounded-lg border border-border bg-card p-1">
        {(["generate", "repository"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setError(""); }}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors",
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "generate" ? "Generate" : "Repository"}
          </button>
        ))}
      </div>

      {error && <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="mb-6 rounded-lg border border-emerald-600/30 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      {tab === "generate" && (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {/* ── Form ── */}
          <div className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Job title" required error={fieldErrors.title}>
                <input
                  className={fieldErrors.title ? inputErrCls : inputCls}
                  value={fields.title}
                  onChange={(e) => { set("title", e.target.value); setFieldErrors((f) => ({ ...f, title: undefined })); }}
                  placeholder="e.g. Site Engineer"
                />
              </Field>

              <Field label="Location">
                <input className={inputCls} value={fields.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Hyderabad" />
              </Field>

              <Field label="Reporting to">
                <input className={inputCls} value={fields.reporting} onChange={(e) => set("reporting", e.target.value)} placeholder="e.g. Project Manager" />
              </Field>

              {/* Experience: min + max number inputs */}
              <div>
                <span className="mb-1.5 block text-sm font-medium text-foreground">Experience (years)</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input
                      type="number"
                      min={0}
                      max={50}
                      className={cn(fieldErrors.expMin ? inputErrCls : inputCls, "no-spinner")}
                      value={expMin}
                      onChange={(e) => { handleExpInput(e.target.value, setExpMin); setFieldErrors((f) => ({ ...f, expMin: undefined })); }}
                      placeholder="Min"
                    />
                    {fieldErrors.expMin && <p className="mt-1 text-xs text-destructive">{fieldErrors.expMin}</p>}
                  </div>
                  <span className="text-sm text-muted-foreground">to</span>
                  <div className="flex-1">
                    <input
                      type="number"
                      min={0}
                      max={50}
                      className={cn(fieldErrors.expMax ? inputErrCls : inputCls, "no-spinner")}
                      value={expMax}
                      onChange={(e) => { handleExpInput(e.target.value, setExpMax); setFieldErrors((f) => ({ ...f, expMax: undefined })); }}
                      placeholder="Max"
                    />
                    {fieldErrors.expMax && <p className="mt-1 text-xs text-destructive">{fieldErrors.expMax}</p>}
                  </div>
                </div>
                {fields.experience && (
                  <p className="mt-1 text-xs text-muted-foreground">{fields.experience}</p>
                )}
              </div>
            </div>

            <Field label="Required skills" required error={fieldErrors.skills}>
              <input
                className={fieldErrors.skills ? inputErrCls : inputCls}
                value={fields.skills}
                onChange={(e) => { set("skills", e.target.value); setFieldErrors((f) => ({ ...f, skills: undefined })); }}
                placeholder="e.g. RCC, QA/QC, AutoCAD"
              />
            </Field>

            <Field label="Key responsibilities" required error={fieldErrors.responsibilities}>
              <textarea
                className={cn(fieldErrors.responsibilities ? inputErrCls : inputCls, "min-h-24 resize-y")}
                value={fields.responsibilities}
                onChange={(e) => { set("responsibilities", e.target.value); setFieldErrors((f) => ({ ...f, responsibilities: undefined })); }}
                placeholder="A few bullet points or notes..."
              />
            </Field>

            <Field label="Other requirements">
              <textarea className={cn(inputCls, "min-h-20 resize-y")} value={fields.requirements} onChange={(e) => set("requirements", e.target.value)} placeholder="Optional" />
            </Field>

            <Button size="lg" onClick={generate} disabled={generating} className="w-full">
              {generating ? <><Spinner /> Generating…</> : <><Sparkles /> Generate JD</>}
            </Button>
          </div>

          {/* ── Preview ── */}
          <div className="flex flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Preview</p>
              {body && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditing((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    {editing ? <><Eye className="size-3.5" /> Preview</> : <><Pencil className="size-3.5" /> Edit</>}
                  </button>
                  <Button size="sm" onClick={save} disabled={saving}>
                    {saving ? <><Spinner /> Saving…</> : <><Save /> Save</>}
                  </Button>
                </div>
              )}
            </div>

            {/* Fixed-height scrollable content area */}
            <div className="h-[32rem] overflow-y-auto rounded-lg border border-border bg-background p-4">
              {body ? (
                editing ? (
                  <textarea
                    className="h-full w-full resize-none bg-transparent text-sm text-foreground outline-none"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    spellCheck={false}
                  />
                ) : (
                  <Markdown md={body} />
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
                  <FileText className="mb-2 size-8 opacity-40" />
                  Fill the form and generate to preview the JD here.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "repository" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input className={cn(inputCls, "pl-9")} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, skills, content..." />
            </div>
            <div className="max-h-[32rem] space-y-2 overflow-auto">
              {loadingList && <p className="px-1 py-6 text-center text-sm text-muted-foreground">Loading…</p>}
              {!loadingList && jds.length === 0 && (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No saved JDs yet. Generate one to get started.
                </p>
              )}
              {jds.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setSelected(j)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selected?.id === j.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                  )}
                >
                  <p className="truncate text-sm font-semibold text-foreground">{j.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[j.location, j.experience].filter(Boolean).join(" · ") || "No metadata"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-bold tracking-tight">{selected.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[selected.location, selected.reporting && `Reports to ${selected.reporting}`, selected.experience].filter(Boolean).join(" · ") || "No metadata"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={jdApi.downloadMd(selected.id)} className={cn("inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-muted")}><Download className="size-4" /> .md</a>
                    <a href={jdApi.downloadDocx(selected.id)} className={cn("inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-muted")}><Download className="size-4" /> .docx</a>
                    <Button variant="destructive" size="sm" onClick={() => remove(selected)}><Trash2 /> Delete</Button>
                  </div>
                </div>
                <div className="mt-4 h-[28rem] overflow-y-auto">
                  <Markdown md={selected.content} />
                </div>
              </>
            ) : (
              <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <ArrowRight className="mb-2 size-8 opacity-40" />
                Select a JD to preview it, or download it as Markdown or Word.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
