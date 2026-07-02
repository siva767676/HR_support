import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* Shared form primitives for the app modules (JD Generation, CV Analyzer,
   AI Interview) so they stay visually consistent. */

export const inputCls =
  "w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground hover:border-input/70 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15";

export const inputErrCls =
  "w-full rounded-xl border border-destructive bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-destructive focus-visible:ring-4 focus-visible:ring-destructive/15";

export function PageHeader({
  icon, eyebrow, title, description, actions,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#ee2730,#d11218)] text-white shadow-[0_8px_20px_-6px_rgba(225,26,32,0.5)] ring-1 ring-inset ring-white/20">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
            <span className="h-px w-7 bg-gradient-to-r from-primary/70 to-transparent" aria-hidden="true" />
          </p>
          <h1 className="mt-2 text-balance font-heading text-[1.7rem] font-bold leading-[1.1] tracking-tight text-foreground sm:text-[2rem]">{title}</h1>
          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">{description}</p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 sm:pt-1">{actions}</div>}
    </header>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
      aria-hidden="true"
    />
  );
}

export function Field({
  label, required, error, hint, children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export type DropdownOption = string | { value: string; label: string };

/* Lightweight, accessible dropdown (no external dependency). Closes on outside
   click and Escape, highlights the active option. Accepts plain string options
   or { value, label } pairs (e.g. an id with a display title). */
export function Dropdown({
  value, onChange, options, placeholder, icon, invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const current = opts.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex w-full items-center gap-2 rounded-xl border bg-background px-3.5 py-2.5 text-left text-sm outline-none transition-[border-color,box-shadow] duration-150 hover:border-input/70 focus-visible:ring-4",
          invalid
            ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/15"
            : "border-input focus-visible:border-ring focus-visible:ring-ring/15",
          open && !invalid && "border-ring ring-4 ring-ring/15",
        )}
      >
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className={cn("flex-1 truncate", current ? "text-foreground" : "text-muted-foreground")}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1.5 max-h-64 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-xl ring-1 ring-black/5"
        >
          {opts.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={value === o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                value === o.value ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-muted",
                o.value === "Others" && "mt-1 border-t border-border/70 pt-2.5 text-muted-foreground",
              )}
            >
              <span className="truncate">{o.value === "Others" ? "Others (specify)" : o.label}</span>
              {value === o.value && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Surfaces & layout ─────────────────────────── */

const PAD = { none: "", sm: "p-4", md: "p-5", lg: "p-6" } as const;

/* The single card primitive for the app. One radius, border, surface and shadow,
   so every module card looks identical. `hover` adds the landing page's hover-lift. */
export function SurfaceCard({
  as: Tag = "div", pad = "lg", hover = false, className, children, ...rest
}: {
  as?: "div" | "section";
  pad?: keyof typeof PAD;
  hover?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04),0_6px_20px_-8px_rgba(16,24,40,0.10)]",
        PAD[pad],
        hover && "hover-lift",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* Uppercase micro-heading used inside cards/drawers (e.g. "Resume preview"). */
export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)}>
      {children}
    </p>
  );
}

/* ───────────────────────────── Segmented control ───────────────────────── */

/* Canonical replacement for the three divergent tab toggles across modules. */
export function SegmentedControl<T extends string>({
  value, onChange, options, size = "md", className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex w-fit gap-1 rounded-xl border border-border/70 bg-muted/60 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg font-medium transition-all duration-150",
            size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
            value === o.value
              ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.06),0_2px_6px_-2px_rgba(16,24,40,0.10)] ring-1 ring-black/[0.04]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ──────────────────────────── Status chips & tone ──────────────────────── */

export type ChipTone = "strong" | "good" | "weak" | "fail" | "neutral";

const CHIP_TONE: Record<ChipTone, string> = {
  strong: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  good: "bg-amber-50 text-amber-700 ring-amber-600/20",
  weak: "bg-destructive/5 text-destructive/80 ring-destructive/15",
  fail: "bg-destructive/10 text-destructive ring-destructive/20",
  neutral: "bg-muted text-muted-foreground ring-border",
};

/* Screening recommendations → tone. */
export function matchTone(rec: string | null | undefined): ChipTone {
  if (rec === "Strong Match") return "strong";
  if (rec === "Good Match") return "good";
  if (rec === "Weak Match") return "weak";
  if (rec === "Evaluation failed") return "fail";
  return "neutral";
}

/* Interview hire recommendations → tone. */
export function hireTone(rec: string | null | undefined): ChipTone {
  if (rec === "Strong Hire" || rec === "Hire") return "strong";
  if (rec === "Maybe") return "good";
  if (rec === "No Hire") return "fail";
  return "neutral";
}

export function StatusChip({
  tone, size = "md", className, children,
}: {
  tone: ChipTone;
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold ring-1 ring-inset",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ──────────────────────────── Score meter & tone ───────────────────────── */

/* The single source of truth for score thresholds across the whole app. */
export function scoreTone(score: number): "strong" | "good" | "weak" {
  if (score >= 75) return "strong";
  if (score >= 55) return "good";
  return "weak";
}

export function scoreBarClass(score: number): string {
  const t = scoreTone(score);
  return t === "strong" ? "bg-emerald-500" : t === "good" ? "bg-amber-500" : "bg-chart-3";
}

const METER_H = { sm: "h-1.5", md: "h-2", lg: "h-2.5" } as const;

/* Horizontal score bar with an optional trailing number. `value`/`max` lets the
   interview module pass 0–10 sub-scores as value*10, max=100. */
export function ScoreMeter({
  value, max = 100, showValue = false, size = "md", className,
}: {
  value: number;
  max?: number;
  showValue?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const rounded = Math.round(value);
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className={cn("w-full overflow-hidden rounded-full bg-muted", METER_H[size])}>
        <span
          className={cn("block h-full rounded-full transition-all", scoreBarClass(pct))}
          style={{ width: `${pct}%` }}
        />
      </span>
      {showValue && (
        <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{rounded}</span>
      )}
    </span>
  );
}

/* ───────────────────────────────── Stat tile ──────────────────────────── */

export function StatTile({
  label, value, accent, icon, iconClass, delta, hint, className,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  icon?: React.ReactNode;
  iconClass?: string;
  delta?: { value: string; dir: "up" | "down" };
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <SurfaceCard pad="none" className={cn("lift-sm p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon && (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary", iconClass)}>
            {icon}
          </span>
        )}
      </div>
      <p className={cn("mt-2.5 font-heading text-[1.65rem] font-bold leading-none tracking-tight tabular-nums text-foreground", accent)}>{value}</p>
      {(delta || hint) && (
        <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
          {delta && (
            <span className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
              delta.dir === "up" ? "bg-emerald-50 text-emerald-700" : "bg-destructive/10 text-destructive",
            )}>
              {delta.dir === "up" ? "↑" : "↓"}{delta.value}
            </span>
          )}
          {hint}
        </div>
      )}
    </SurfaceCard>
  );
}

/* ─────────────────────────── Empty & error states ──────────────────────── */

export function EmptyState({
  icon, title, description, action, className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  icon, title, description, action, className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        {icon}
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ───────────────────────────────── Banner ─────────────────────────────── */

const BANNER_TONE = {
  error: "border-destructive/30 bg-destructive/8 text-destructive",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-300/50 bg-amber-50 text-amber-800",
} as const;

const BANNER_ICON = {
  error: <AlertCircle className="mt-0.5 size-4 shrink-0" />,
  success: <CheckCircle2 className="mt-0.5 size-4 shrink-0" />,
  warn: <AlertTriangle className="mt-0.5 size-4 shrink-0" />,
};

/* Inline page-level message strip (distinct from transient toasts). */
export function Banner({
  tone, icon, className, children,
}: {
  tone: keyof typeof BANNER_TONE;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm", BANNER_TONE[tone], className)}>
      {icon ?? BANNER_ICON[tone]}
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

/* ──────────────────────────────── Skeleton ────────────────────────────── */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("animate-shimmer rounded bg-muted", className)} style={style} />;
}

/* ─────────────────────────────── PhaseProgress ─────────────────────────── */

/* Unified progress for multi-stage flows (screening pipeline, interview Q&A).
   Renders a percentage bar and, when `stages` is given, a labelled stage track. */
export function PhaseProgress({
  percent, stages, currentKey, caption, className,
}: {
  percent: number;
  stages?: { key: string; label: string }[];
  currentKey?: string;
  caption?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const currentIdx = stages && currentKey ? stages.findIndex((s) => s.key === currentKey) : -1;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{caption ?? "Progress"}</span>
        <span className="tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {stages && (
        <div className="hidden gap-1 pt-2 sm:grid" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => {
            const done = currentIdx >= 0 && i < currentIdx;
            const current = i === currentIdx;
            return (
              <div key={s.key} className="text-center">
                <div className={cn("mx-auto mb-1 h-0.5 rounded-full transition-colors", done ? "bg-primary" : current ? "bg-primary/40" : "bg-muted")} />
                <span className={cn("text-[10px] leading-tight transition-colors", done ? "text-primary" : current ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────── Stepper ────────────────────────────── */

/* Numbered step indicator for a phase-driven flow. Numbers are 1-indexed. */
export function Stepper({
  steps,
  current,
  className,
}: {
  steps: string[];
  current: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 text-sm font-medium text-muted-foreground", className)}>
      {steps.map((step, i) => {
        const num = i + 1;
        const active = num === current;
        const done = num < current;
        return (
          <div key={i} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-full text-xs font-bold transition-all",
                active
                  ? "bg-[linear-gradient(145deg,#ee2730,#d11218)] text-white shadow-[0_0_0_4px_rgba(225,26,32,0.14)]"
                  : done ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-4" /> : num}
            </span>
            <span className={cn("hidden sm:inline", active || done ? "text-foreground" : "")}>{step}</span>
            {i < steps.length - 1 && <span className={cn("mx-1 hidden h-px w-3 sm:block", active || done ? "bg-primary" : "bg-border")} />}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────── SelectCard ────────────────────────────── */

/* Large mode-select card for a prominent binary or ternary choice in a flow. */
export function SelectCard({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; description?: string; icon?: React.ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all",
            value === opt.value
              ? "border-primary bg-primary/5"
              : "border-border bg-background hover:border-primary/50 hover:bg-muted/50",
          )}
        >
          {opt.icon && <span className="text-primary">{opt.icon}</span>}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{opt.label}</p>
            {opt.description && <p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>}
          </div>
          <span
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
              value === opt.value ? "border-primary bg-primary" : "border-border",
            )}
          >
            {value === opt.value && <Check className="size-3.5 text-primary-foreground" />}
          </span>
        </button>
      ))}
    </div>
  );
}
