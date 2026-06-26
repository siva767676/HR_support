import { createContext, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/* App-wide toast system. Mount <ToastProvider> at the root of each module's
   returned tree (Astro can't bridge React context across the island boundary),
   then call useToast().toast(message, type) from anywhere inside it. */

export type ToastType = "success" | "warn" | "error";
type ToastItem = { id: number; text: string; type: ToastType };

const ToastCtx = createContext<{ toast: (text: string, type?: ToastType) => void } | null>(null);

let _seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function toast(text: string, type: ToastType = "success") {
    const id = ++_seq;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed right-5 top-5 z-[60] flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex max-w-sm items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg animate-in fade-in slide-in-from-right-4 duration-200",
              t.type === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800",
              t.type === "warn" && "border-amber-200 bg-amber-50 text-amber-800",
              t.type === "error" && "border-destructive/25 bg-destructive/10 text-destructive",
            )}
          >
            {t.type === "success" && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
            {t.type === "warn" && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />}
            {t.type === "error" && <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
            <span className="leading-relaxed">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
