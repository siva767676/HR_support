import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/* Shared form primitives for the app modules (JD Generation, CV Analyzer,
   AI Interview) so they stay visually consistent. */

export const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

export const inputErrCls =
  "w-full rounded-lg border border-destructive bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-destructive focus-visible:ring-3 focus-visible:ring-destructive/30";

export function PageHeader({
  icon, eyebrow, title, description,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8 flex items-start gap-4">
      <div className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 sm:flex">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">{description}</p>
      </div>
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
          "flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3",
          invalid
            ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30"
            : "border-input focus-visible:border-ring focus-visible:ring-ring/30",
          open && !invalid && "border-ring ring-3 ring-ring/30",
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
