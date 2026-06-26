import { useEffect, useRef, useState } from "react";
import {
  FileText, Search, Download, Trash2, Sparkles, Save, ArrowRight, Pencil, Eye,
  Check, Maximize2, Minimize2, Copy, X, Briefcase, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Markdown from "./Markdown";
import { Dropdown, Field, PageHeader, Spinner, inputCls, inputErrCls } from "./ui";
import { jd as jdApi, type JdFields, type JdRecord } from "@/lib/api";

/* Common roles and locations for a construction / engineering org. "Others"
   reveals a free-text field so any role/location is still possible. */
const ROLES = [
  "Site Engineer", "Project Manager", "Civil Engineer", "Structural Engineer",
  "Planning Engineer", "QA/QC Engineer", "Safety Officer (EHS)", "MEP Engineer",
  "Quantity Surveyor", "Billing Engineer", "Procurement Engineer", "Architect",
  "Construction Manager", "Project Coordinator", "AI Engineer", "Others",
];
const LOCATIONS = [
  "Hyderabad", "Bengaluru", "Chennai", "Mumbai", "Pune",
  "Delhi NCR", "Visakhapatnam", "Vijayawada", "Kolkata", "Others",
];

/* Animated skeleton shown in the preview while the model is generating. */
function PreviewSkeleton() {
  const Bar = ({ w }: { w: string }) => (
    <div className="h-3 animate-pulse rounded bg-muted" style={{ width: w }} />
  );
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Spinner className="text-primary" /> Drafting the job description…
      </div>
      <div className="space-y-3">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <Bar w="100%" /><Bar w="92%" /><Bar w="97%" /><Bar w="60%" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        <Bar w="88%" /><Bar w="95%" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-36 animate-pulse rounded bg-muted" />
        {["94%", "82%", "90%", "70%"].map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary/40" />
            <div className="h-3 animate-pulse rounded bg-muted" style={{ width: w }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const EMPTY: JdFields = {
  title: "",
  location: "Hyderabad",
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
  const [roleChoice, setRoleChoice] = useState("");
  const [roleCustom, setRoleCustom] = useState("");
  const [locChoice, setLocChoice] = useState("Hyderabad");
  const [locCustom, setLocCustom] = useState("");
  const [expMin, setExpMin] = useState("");
  const [expMax, setExpMax] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false); // hidden until Generate
  const [genError, setGenError] = useState("");          // generation failure, shown inside the preview
  const [genSeq, setGenSeq] = useState(0);               // bumped each run so the slide-in replays
  const [generatingSkills, setGeneratingSkills] = useState(false);
  const [generatingResponsibilities, setGeneratingResponsibilities] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // repository
  const [search, setSearch] = useState("");
  const [jds, setJds] = useState<JdRecord[]>([]);
  const [selected, setSelected] = useState<JdRecord | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const set = (k: keyof JdFields, v: string) => setFields((f) => ({ ...f, [k]: v }));

  // Job role: dropdown choice (or custom when "Others") drives fields.title.
  function chooseRole(v: string) {
    setRoleChoice(v);
    set("title", v === "Others" ? roleCustom.trim() : v);
    setFieldErrors((f) => ({ ...f, title: undefined }));
  }
  function customRole(v: string) {
    setRoleCustom(v);
    set("title", v.trim());
    setFieldErrors((f) => ({ ...f, title: undefined }));
  }
  // Location: dropdown choice (or custom when "Others") drives fields.location.
  function chooseLoc(v: string) {
    setLocChoice(v);
    set("location", v === "Others" ? locCustom.trim() : v);
  }
  function customLoc(v: string) {
    setLocCustom(v);
    set("location", v.trim());
  }

  // Sync experience string from min/max whenever they change.
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

  // Lock body scroll while the full-screen preview is open.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [expanded]);

  // On small screens the preview renders below the form; bring it into view on generate.
  useEffect(() => {
    if (!showPreview || !previewRef.current) return;
    if (window.matchMedia("(max-width: 1023px)").matches) {
      previewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showPreview, genSeq]);

  function validateFields(): boolean {
    const errs: FieldErrors = {};

    if (!fields.title.trim()) {
      errs.title = roleChoice === "Others" ? "Enter the custom job role." : "Select a job role.";
    } else if (fields.title.trim().length < 2) {
      errs.title = "Job role must be at least 2 characters.";
    }
    if (!fields.skills?.trim()) {
      errs.skills = "At least one required skill is needed.";
    }
    if (!fields.responsibilities?.trim()) {
      errs.responsibilities = "Key responsibilities are required to generate a meaningful JD.";
    }
    if (expMin !== "") {
      const min = Number(expMin);
      if (!Number.isFinite(min) || min < 0 || min > 50) errs.expMin = "Enter a value between 0 and 50.";
    }
    if (expMax !== "") {
      const max = Number(expMax);
      if (!Number.isFinite(max) || max < 0 || max > 50) errs.expMax = "Enter a value between 0 and 50.";
    }
    if (expMin !== "" && expMax !== "" && !errs.expMin && !errs.expMax && Number(expMin) > Number(expMax)) {
      errs.expMax = "Max must be greater than or equal to min.";
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function generate() {
    if (generating) return;            // guard against a fast double-click
    setError("");
    setNotice("");
    setGenError("");
    if (!validateFields()) return;
    setShowPreview(true);              // panel slides in and shows the skeleton
    setGenSeq((n) => n + 1);           // replay the slide-in on every run
    setGenerating(true);
    setEditing(false);
    // Keep the current body: the skeleton covers it while generating, and a failed
    // re-generation must not destroy a previously good (or hand-edited) JD.
    try {
      const res = await jdApi.generate(fields);
      setBody(res.body);
      setGenError("");
    } catch (e) {
      // Surface the failure inline; the panel and any existing body stay intact.
      setGenError(e instanceof Error ? e.message : "JD generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    setError("");
    if (!validateFields()) { setExpanded(false); return; } // can't save with invalid metadata
    if (!body.trim()) return setError("Generate or write a JD body first.");
    setSaving(true);
    try {
      const rec = await jdApi.create(fields, body);
      setNotice(`Saved "${rec.title}" to the repository.`);
      setBody("");
      setFields(EMPTY);
      setRoleChoice(""); setRoleCustom(""); setLocChoice("Hyderabad"); setLocCustom("");
      setExpMin(""); setExpMax(""); setFieldErrors({});
      setEditing(false); setExpanded(false); setShowPreview(false); setGenError("");
      await loadList();
      setSelected(rec);
      setTab("repository");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the JD.");
    } finally {
      setSaving(false);
    }
  }

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  }

  async function generateSkills() {
    const title = roleChoice === "Others" ? roleCustom : roleChoice;
    if (!title.trim()) return;
    setGeneratingSkills(true);
    try {
      const skills = await jdApi.generateSkills(title);
      set("skills", skills);
      setFieldErrors((f) => ({ ...f, skills: undefined }));
    } catch (e) {
      setFieldErrors((f) => ({ ...f, skills: e instanceof Error ? e.message : "Could not generate skills." }));
    } finally {
      setGeneratingSkills(false);
    }
  }

  async function generateResponsibilities() {
    const title = roleChoice === "Others" ? roleCustom : roleChoice;
    if (!title.trim()) return;
    setGeneratingResponsibilities(true);
    try {
      const responsibilities = await jdApi.generateResponsibilities(title);
      set("responsibilities", responsibilities);
      setFieldErrors((f) => ({ ...f, responsibilities: undefined }));
    } catch (e) {
      setFieldErrors((f) => ({ ...f, responsibilities: e instanceof Error ? e.message : "Could not generate responsibilities." }));
    } finally {
      setGeneratingResponsibilities(false);
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

  // Clamp numeric experience input to 0–50.
  function handleExpInput(val: string, setter: (v: string) => void) {
    if (val === "") { setter(""); return; }
    const n = parseInt(val, 10);
    if (isNaN(n)) return;
    setter(String(Math.min(50, Math.max(0, n))));
  }

  /* Preview body: skeleton while generating; the JD (rendered or editable) when
     ready; an inline error when a first generation failed; else an empty state. */
  const previewContent =
    generating ? <PreviewSkeleton /> :
    body ? (
      editing ? (
        <textarea
          className="h-full w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed text-foreground outline-none"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <>
          {genError && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Could not regenerate: {genError}. Showing the previous version.
            </div>
          )}
          <Markdown md={body} />
        </>
      )
    ) : genError ? (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
          <X className="size-7 text-destructive/70" />
        </div>
        <p className="text-sm font-medium text-foreground">Generation failed</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{genError}</p>
        <Button size="sm" className="mt-4" onClick={generate}><Sparkles /> Try again</Button>
      </div>
    ) : (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted">
          <FileText className="size-7 text-muted-foreground/60" />
        </div>
        <p className="text-sm font-medium text-foreground">Your generated JD will appear here</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          Pick a role and a few details on the left, then generate a complete, on-template job description.
        </p>
      </div>
    );

  return (
    <div className="overflow-x-clip">
      <PageHeader
        icon={<FileText className="size-6" />}
        eyebrow="JD Generation"
        title="Job Descriptions"
        description="Turn a few inputs into a complete JD in the company standard template, then save it to the repository to reuse in screening and interviews."
      />

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
        // Wrapper is centered and grows from the form's width to full width when the
        // preview opens, so the lone form reads as a focused, centered card.
        <div className={cn(
          "transition-[max-width] duration-500 ease-out lg:mx-auto",
          showPreview ? "lg:max-w-[1536px]" : "lg:max-w-4xl",
        )}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-8">
            {/* ------- Input form (centered ~55% alone; settles to ~34% left once preview opens) ------- */}
            <div className={cn(
              "w-full space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm transition-[width] duration-500 ease-out lg:shrink-0 lg:p-7",
              showPreview ? "lg:w-[34%]" : "lg:w-full",
            )}>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Job role" required error={fieldErrors.title}>
                  <Dropdown value={roleChoice} onChange={chooseRole} options={ROLES} placeholder="Select a role" icon={<Briefcase className="size-4" />} invalid={!!fieldErrors.title} />
                </Field>
                <Field label="Location">
                  <Dropdown value={locChoice} onChange={chooseLoc} options={LOCATIONS} placeholder="Select a location" icon={<MapPin className="size-4" />} />
                </Field>
              </div>

              {(roleChoice === "Others" || locChoice === "Others") && (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {roleChoice === "Others" && (
                    <Field label="Custom role" required>
                      <input className={inputCls} value={roleCustom} onChange={(e) => customRole(e.target.value)} placeholder="e.g. Tunnel Engineer" autoFocus />
                    </Field>
                  )}
                  {locChoice === "Others" && (
                    <Field label="Custom location">
                      <input className={inputCls} value={locCustom} onChange={(e) => customLoc(e.target.value)} placeholder="e.g. Coimbatore" />
                    </Field>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Reporting to">
                  <input className={inputCls} value={fields.reporting} onChange={(e) => set("reporting", e.target.value)} placeholder="e.g. Project Manager" />
                </Field>
                {/* Experience: min + max number inputs */}
                <div>
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Experience (years)</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <input
                        type="number" min={0} max={50}
                        className={cn(fieldErrors.expMin ? inputErrCls : inputCls, "no-spinner")}
                        value={expMin}
                        onChange={(e) => { handleExpInput(e.target.value, setExpMin); setFieldErrors((f) => ({ ...f, expMin: undefined })); }}
                        placeholder="Min"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">to</span>
                    <div className="flex-1">
                      <input
                        type="number" min={0} max={50}
                        className={cn(fieldErrors.expMax ? inputErrCls : inputCls, "no-spinner")}
                        value={expMax}
                        onChange={(e) => { handleExpInput(e.target.value, setExpMax); setFieldErrors((f) => ({ ...f, expMax: undefined })); }}
                        placeholder="Max"
                      />
                    </div>
                  </div>
                  {(fieldErrors.expMin || fieldErrors.expMax) && (
                    <p className="mt-1 text-xs text-destructive">{fieldErrors.expMin || fieldErrors.expMax}</p>
                  )}
                  {fields.experience && !fieldErrors.expMin && !fieldErrors.expMax && (
                    <p className="mt-1 text-xs text-muted-foreground">{fields.experience}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    Required skills
                    <span className="ml-0.5 text-destructive">*</span>
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={generateSkills}
                    disabled={generatingSkills || (!roleChoice && !roleCustom)}
                    className="text-xs"
                  >
                    {generatingSkills ? <Spinner className="mr-1.5" /> : <Sparkles className="mr-1.5 size-3.5" />}
                    Generate
                  </Button>
                </div>
                <input
                  className={fieldErrors.skills ? inputErrCls : inputCls}
                  value={fields.skills}
                  onChange={(e) => { set("skills", e.target.value); setFieldErrors((f) => ({ ...f, skills: undefined })); }}
                  placeholder="e.g. RCC, QA/QC, AutoCAD"
                />
                {fieldErrors.skills && <p className="mt-1 text-xs text-destructive">{fieldErrors.skills}</p>}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    Key responsibilities
                    <span className="ml-0.5 text-destructive">*</span>
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={generateResponsibilities}
                    disabled={generatingResponsibilities || (!roleChoice && !roleCustom)}
                    className="text-xs"
                  >
                    {generatingResponsibilities ? <Spinner className="mr-1.5" /> : <Sparkles className="mr-1.5 size-3.5" />}
                    Generate
                  </Button>
                </div>
                <textarea
                  className={cn(fieldErrors.responsibilities ? inputErrCls : inputCls, "min-h-24 resize-y")}
                  value={fields.responsibilities}
                  onChange={(e) => { set("responsibilities", e.target.value); setFieldErrors((f) => ({ ...f, responsibilities: undefined })); }}
                  placeholder="A few bullet points or notes..."
                />
                {fieldErrors.responsibilities && <p className="mt-1 text-xs text-destructive">{fieldErrors.responsibilities}</p>}
              </div>

              <Field label="Other requirements">
                <textarea className={cn(inputCls, "min-h-20 resize-y")} value={fields.requirements} onChange={(e) => set("requirements", e.target.value)} placeholder="Optional" />
              </Field>

              <Button size="lg" onClick={generate} disabled={generating} className="w-full">
                {generating ? <><Spinner /> Generating JD…</> : <><Sparkles /> Generate JD</>}
              </Button>
            </div>

            {/* -------- Preview: hidden until Generate, then slides in from the right (~65%) -------- */}
            {showPreview && (
              <div ref={previewRef} className="w-full min-w-0 lg:relative lg:flex-1">
                {/* On lg the card absolutely fills the slot, which flex-stretches to the
                    form's height — so the preview matches the form and scrolls inside
                    rather than growing the row. */}
                <div key={genSeq} className="animate-slide-in-right lg:absolute lg:inset-0">
                  <div className="flex flex-col rounded-2xl border border-border bg-card shadow-sm lg:h-full lg:min-h-[30rem]">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Preview</p>
                        {(fields.title || generating) && (
                          <p className="truncate text-xs text-muted-foreground">
                            {generating ? "Generating…" : [fields.title, fields.location].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      {body && !generating && (
                        <div className="flex items-center gap-1.5">
                          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
                            {editing ? <><Eye /> Preview</> : <><Pencil /> Edit</>}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={copyBody}>
                            {copied ? <><Check className="text-emerald-600" /> Copied</> : <><Copy /> Copy</>}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
                            <Maximize2 /> Expand
                          </Button>
                          <Button size="sm" onClick={save} disabled={saving}>
                            {saving ? <><Spinner /> Saving…</> : <><Save /> Save</>}
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="h-[32rem] overflow-auto p-6 lg:h-auto lg:min-h-0 lg:flex-1 lg:p-8">
                      {previewContent}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "repository" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
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

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
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

      {/* ------------------------- Full-screen preview ------------------------- */}
      {expanded && body && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/50 p-3 backdrop-blur-sm sm:p-6" onMouseDown={() => setExpanded(false)}>
          <div
            className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-base font-bold tracking-tight">{fields.title || "Job Description"}</p>
                {(fields.title || fields.location) && (
                  <p className="truncate text-xs text-muted-foreground">{[fields.title, fields.location].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
                  {editing ? <><Eye /> Preview</> : <><Pencil /> Edit</>}
                </Button>
                <Button variant="ghost" size="sm" onClick={copyBody}>
                  {copied ? <><Check className="text-emerald-600" /> Copied</> : <><Copy /> Copy</>}
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? <><Spinner /> Saving…</> : <><Save /> Save</>}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Collapse full screen" onClick={() => setExpanded(false)}><Minimize2 /></Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto px-6 py-6 sm:px-8">
              {editing ? (
                <textarea
                  className="mx-auto block h-full w-full max-w-3xl resize-none rounded-lg border border-border bg-background p-4 font-mono text-sm leading-relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
              ) : (
                <div className="mx-auto max-w-3xl">
                  <Markdown md={body} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
