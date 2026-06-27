/* Lightweight persistent storage + a navigation guard for in-progress work.

   The three app tools are separate Astro pages, so navigating between them is a
   full page load that would otherwise discard a module's React state. We persist
   each module's working state and restore it on mount. Long-running server work (a
   screening run, an interview thread) is identified by an id we persist, so the
   module can re-attach to it after navigating away and back.

   Backed by localStorage so the state survives navigation, a normal reload, a hard
   refresh, tab close, and a browser restart. Stale handles are harmless: a lost
   screening run / interview thread is re-validated against the server on restore
   and falls back to a clean start.

   The busy flag drives a "leave this page?" warning: a native beforeunload prompt
   for reloads/tab-close, and a confirm() interception of the sidebar links
   (wired in App.astro / MobileNav) for in-app navigation. */

export const SESSION_KEYS = {
  jd: "medha:jd",
  screening: "medha:screening",
  interview: "medha:interview",
  forward: "medha:forward", // {runId} pointer handed from screening to the interview page
} as const;

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSession<T extends object>(key: string, fallback: T): T {
  const s = store();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function saveSession(key: string, value: unknown): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or serialization failure — non-fatal */
  }
}

export function clearSession(key: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* ignore */
  }
}

const BEFORE_UNLOAD_MSG =
  "You have work in progress. It is saved and will be restored when you return.";

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = BEFORE_UNLOAD_MSG;
  return BEFORE_UNLOAD_MSG;
}

/* Mark the current page as having in-progress work. Sets a global flag the
   sidebar reads before navigating, and arms the browser's unload prompt. */
export function setBusy(busy: boolean): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __MEDHA_BUSY__?: boolean }).__MEDHA_BUSY__ = busy;
  window.removeEventListener("beforeunload", onBeforeUnload);
  if (busy) window.addEventListener("beforeunload", onBeforeUnload);
}
