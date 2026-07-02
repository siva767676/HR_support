import { useEffect, useState } from "react";
import { LayoutDashboard, ScanSearch, Users, CheckCircle2, Gauge, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PageHeader, SurfaceCard, SectionTitle, StatTile, StatusChip, hireTone,
  Banner, EmptyState, Spinner, type ChipTone,
} from "./ui";
import { saveSession, SESSION_KEYS } from "@/lib/session";
import { dashboard, type ScreeningRunSummary, type InterviewRecord } from "@/lib/api";

function fmtDate(s: string): string {
  // server returns "YYYY-MM-DD HH:MM:SS" (UTC) — show the date + HH:MM
  return s ? s.slice(0, 16).replace("T", " ") : "";
}

const STATUS_TONE: Record<string, ChipTone> = {
  completed: "strong",
  in_progress: "good",
  expired: "fail",
};
const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  in_progress: "In progress",
  expired: "Expired",
};

export default function DashboardModule() {
  const [runs, setRuns] = useState<ScreeningRunSummary[]>([]);
  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([dashboard.screeningRuns(), dashboard.interviews()])
      .then(([r, i]) => { if (!cancelled) { setRuns(r); setInterviews(i); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the dashboard."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const candidatesScreened = runs.reduce((s, r) => s + (r.total || 0), 0);
  const completed = interviews.filter((i) => i.status === "completed");
  const avgScore = completed.length
    ? Math.round(completed.reduce((s, i) => s + (i.overall_score || 0), 0) / completed.length)
    : null;

  function continueInterviews(runId: string) {
    saveSession(SESSION_KEYS.forward, { runId });
    window.location.href = "/interview";
  }

  const empty = !loading && runs.length === 0 && interviews.length === 0;

  return (
    <div className="animate-rise">
      <PageHeader
        icon={<LayoutDashboard className="size-6" />}
        eyebrow="Dashboard"
        title="Hiring pipeline overview"
        description="Every screening run and interview in one place — screened candidates, shortlists, interview progress, and outcomes."
      />

      {error && <Banner tone="error" className="mb-6">{error}</Banner>}

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Spinner /> Loading dashboard…</div>
      ) : empty ? (
        <SurfaceCard>
          <EmptyState
            icon={<LayoutDashboard className="size-7" />}
            title="Nothing here yet"
            description="Run a screening in CV Analyzer and interview the shortlist — runs and outcomes will show up here."
            action={<a href="/screening" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"><ScanSearch className="size-4" /> Go to CV Analyzer</a>}
          />
        </SurfaceCard>
      ) : (
        <div className="space-y-8">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Screening runs" value={runs.length} icon={<ScanSearch className="size-4" />} />
            <StatTile label="Candidates screened" value={candidatesScreened} icon={<Users className="size-4" />} iconClass="bg-blue-50 text-blue-600" />
            <StatTile label="Interviews done" value={completed.length} icon={<CheckCircle2 className="size-4" />} accent="text-emerald-600" iconClass="bg-emerald-50 text-emerald-600" />
            <StatTile label="Avg interview score" value={avgScore != null ? avgScore : "—"} icon={<Gauge className="size-4" />} iconClass="bg-amber-50 text-amber-600" />
          </div>

          {/* Screening runs */}
          <section>
            <SectionTitle>Screening runs</SectionTitle>
            {runs.length === 0 ? (
              <SurfaceCard><p className="text-sm text-muted-foreground">No screening runs yet.</p></SurfaceCard>
            ) : (
              <SurfaceCard pad="none" className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_8rem_9rem] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>Role / JD</span><span>Resumes</span><span>Shortlisted</span><span>Interviewed</span><span className="text-right">Action</span>
                  </div>
                  {runs.map((r) => (
                    <div key={r.run_id} className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_8rem_9rem] items-center gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/30">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{r.role || r.jd_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{fmtDate(r.created_at)}</p>
                      </div>
                      <span className="text-sm tabular-nums text-foreground">{r.total}</span>
                      <span className="text-sm tabular-nums text-foreground">{r.shortlisted}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">{r.interviewed_count} / {r.shortlisted}</span>
                      <span className="flex justify-end">
                        {r.shortlisted > 0 && (
                          <Button
                            variant={r.interviewed_count < r.shortlisted ? "default" : "outline"}
                            size="sm"
                            onClick={() => continueInterviews(r.run_id)}
                          >
                            <Bot className="size-3.5" />
                            {r.interviewed_count === 0 ? "Interview" : r.interviewed_count < r.shortlisted ? "Continue" : "Review"}
                          </Button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            )}
          </section>

          {/* Interview outcomes */}
          <section>
            <SectionTitle>Interview outcomes</SectionTitle>
            {interviews.length === 0 ? (
              <SurfaceCard><p className="text-sm text-muted-foreground">No interviews yet.</p></SurfaceCard>
            ) : (
              <SurfaceCard pad="none" className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_9rem_6rem_9rem_8rem] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>Candidate</span><span>Status</span><span>Score</span><span>Recommendation</span><span className="text-right">Updated</span>
                  </div>
                  {interviews.map((i) => (
                    <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_9rem_6rem_9rem_8rem] items-center gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/30">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{i.candidate_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{i.role || "—"}</p>
                      </div>
                      <span>
                        <StatusChip tone={STATUS_TONE[i.status] ?? "neutral"} size="sm">
                          {STATUS_LABEL[i.status] ?? i.status}
                        </StatusChip>
                      </span>
                      <span className="text-sm font-bold tabular-nums text-foreground">
                        {i.overall_score != null ? i.overall_score : "—"}
                      </span>
                      <span>
                        {i.recommendation
                          ? <StatusChip tone={hireTone(i.recommendation)} size="sm">{i.recommendation}</StatusChip>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </span>
                      <span className="text-right text-xs text-muted-foreground">{fmtDate(i.updated_at)}</span>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
