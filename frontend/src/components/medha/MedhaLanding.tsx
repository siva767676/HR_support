import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Menu,
  ArrowRight,
  Upload,
  ScanSearch,
  Gauge,
  ListOrdered,
  Mail,
  Video,
  FileText,
  BarChart3,
  Bot,
  ArrowUpRight,
  Check,
} from "lucide-react";

import Aurora from "@/components/Aurora";
import FlowingMenu from "@/components/FlowingMenu";
import AnimatedContent from "@/components/AnimatedContent";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { steps, faqs } from "@/lib/content";
import Logo from "./Logo";

const navLinks: [string, string][] = [
  ["#top", "Home"],
  ["#features", "Features"],
  ["#how", "How it works"],
  ["#deliverables", "Deliverables"],
  ["#faq", "FAQ"],
  ["#contact", "Contact"],
];

// Branded gradient for the FlowingMenu hover marquee (no external assets).
const pill = (a: string, b: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='240' height='100' rx='14' fill='url(#g)'/></svg>`,
  );

const tools = [
  { text: "JD Generation", link: "/jd", image: pill("#E11A20", "#9F1239") },
  { text: "CV Analyzer", link: "/screening", image: pill("#FF7A45", "#E11A20") },
  { text: "AI Interview Assistant", link: "/interview", image: pill("#9F1239", "#15181D") },
];

const stepIcons = [Upload, ScanSearch, Gauge, ListOrdered, Mail, Video];

const deliverables = [
  {
    kind: "jd",
    icon: FileText,
    kicker: "Job Descriptions",
    text: "Customized job descriptions, formatted to your template.",
    desc: "Turn a few inputs into a complete, structured JD in your house style, ready to post or hand off for review.",
    points: [
      "Role summary, responsibilities, and requirements",
      "Formatted to your standard template",
      "Edit and refine before you save",
    ],
  },
  {
    kind: "score",
    icon: BarChart3,
    kicker: "Scoring and Ranking",
    text: "A scored, ranked summary of every candidate.",
    desc: "Every candidate gets a 0 to 100 fit score and a clear recommendation, so the strongest profiles surface first.",
    points: [
      "Five weighted dimensions per candidate",
      "Matched skills and gaps called out",
      "Export the ranked list to Excel",
    ],
  },
  {
    kind: "interview",
    icon: Bot,
    kicker: "AI Interview",
    text: "AI-assisted interview support and evaluation.",
    desc: "Move shortlisted candidates into a guided round with role-specific questions and a structured score.",
    points: [
      "Questions tailored to the role",
      "Answers rated against the brief",
      "A summary you can share with the panel",
    ],
  },
] as const;

/* ------------------------------ Scroll progress ----------------------------- */
function ScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setP(max > 0 ? (el.scrollTop / max) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-[3px] bg-transparent">
      <div
        className="h-full bg-gradient-to-r from-primary to-[#FF7A45] shadow-[0_0_12px_rgba(225,26,32,0.5)] transition-[width] duration-100 ease-out"
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

/* ----------------------------------- Navbar --------------------------------- */
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-all duration-300",
        scrolled ? "border-border/70 bg-background/80 backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo dark={!scrolled} />

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {navLinks.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className={cn(
                "text-sm font-medium transition-colors",
                scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/70 hover:text-white",
              )}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a href="/screening" className={cn(buttonVariants(), "hidden h-9 rounded-full px-5 md:inline-flex")}>
            Get Started
          </a>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className={cn(
                "inline-flex items-center justify-center rounded-md p-2 transition-colors md:hidden",
                scrolled ? "text-foreground hover:bg-muted" : "text-white hover:bg-white/10",
              )}
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <nav className="mt-10 flex flex-col gap-1 px-2">
                {navLinks.map(([href, label]) => (
                  <a
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2.5 text-base font-medium text-foreground hover:bg-muted"
                  >
                    {label}
                  </a>
                ))}
                <a href="/screening" onClick={() => setOpen(false)} className={cn(buttonVariants(), "mt-3 h-10 rounded-full")}>
                  Get Started
                </a>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------ Hero ---------------------------------- */
function Hero() {
  const root = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      const heading = headingRef.current;
      if (!heading) return;

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Reveal the heading only once GSAP controls it, so there is no flash of
      // un-animated text before hydration paints.
      gsap.set(heading, { autoAlpha: 1 });

      if (reduce) {
        gsap.set(".hero-fade", { opacity: 1, y: 0 });
        return;
      }

      // Cinematic focus-pull: the word drifts up and resolves from heavily
      // blurred + slightly oversized into sharp focus. Animate TO explicit visible
      // end states (not gsap.from), so a re-run or interruption can never leave the
      // heading or the CTA stuck hidden — the bug where Get Started only appeared
      // after a hard refresh.
      gsap.set(".hero-fade", { opacity: 0, y: 18 });

      const reveal = () => {
        gsap.set(heading, { autoAlpha: 1, clearProps: "filter,transform" });
        gsap.set(".hero-fade", { autoAlpha: 1, y: 0, clearProps: "transform" });
      };

      let failsafe = 0;
      const tl = gsap.timeline({
        onComplete: () => {
          window.clearTimeout(failsafe);
          reveal();
        },
      });
      tl.fromTo(
        heading,
        { opacity: 0, scale: 1.12, filter: "blur(34px)", y: 28 },
        { opacity: 1, scale: 1, filter: "blur(0px)", y: 0, duration: 2.3, ease: "power3.out" },
      ).to(
        ".hero-fade",
        { opacity: 1, y: 0, duration: 1.1, stagger: 0.22, ease: "power2.out" },
        "-=1.05",
      );

      // Guarantee visibility even if the rAF timeline is throttled (page opened in a
      // background tab) or interrupted before completing. setTimeout fires regardless.
      failsafe = window.setTimeout(reveal, 4500);
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      id="top"
      className="relative isolate flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-[#07090C] px-4 text-center"
    >
      <div className="absolute inset-0 -z-10">
        <Aurora colorStops={["#E11A20", "#FF7A45", "#9F1239"]} amplitude={1.0} blend={0.62} speed={0.4} />
      </div>
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent_28%,rgba(7,9,12,0.82)_100%)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-background" />

      <h1
        ref={headingRef}
        className="invisible select-none whitespace-nowrap text-[clamp(4.5rem,18vw,16rem)] font-extrabold leading-none tracking-tight text-white"
        style={{ textShadow: "0 2px 55px rgba(225,26,32,0.32)" }}
      >
        MEDHA
      </h1>

      <p className="hero-fade mt-6 text-xs font-semibold uppercase tracking-[0.34em] text-white/55 sm:text-sm">
        AI powered Talent Acquisition
      </p>

      <a
        href="/screening"
        className="hero-fade group mt-10 inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[15px] font-semibold text-[#07090C] shadow-lg shadow-black/30 transition-all duration-200 hover:scale-[1.03] hover:bg-white/90"
      >
        Get Started
        <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </a>

      <div aria-hidden className="absolute bottom-7 left-1/2 -translate-x-1/2">
        <div className="flex h-9 w-5 items-start justify-center rounded-full border border-white/25 p-1">
          <span className="h-2 w-1 animate-bounce rounded-full bg-white/60" />
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------- Features -------------------------------- */
function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-[#0B0E13] py-20 sm:py-24">
      <AnimatedContent distance={50} duration={0.8} scale={0.97}>
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <p className="text-sm font-semibold text-primary">Features</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Pick a tool to get started</h2>
          <p className="mt-3 text-white/60">Choose where to begin.</p>
        </div>
      </AnimatedContent>

      <div className="mx-auto mt-12 max-w-6xl px-4 sm:px-6">
        <div className="h-[clamp(360px,56vh,540px)] overflow-hidden rounded-2xl border border-white/10">
          <FlowingMenu
            items={tools}
            speed={18}
            bgColor="#0B0E13"
            textColor="#F5F5F7"
            borderColor="rgba(255,255,255,0.08)"
            marqueeBgColor="#E11A20"
            marqueeTextColor="#ffffff"
          />
        </div>
        <p className="mt-4 text-center text-xs text-white/40">Hover a tool, then click to open it.</p>
      </div>
    </section>
  );
}

/* -------------------------------- How it works ------------------------------ */
function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <AnimatedContent distance={50} duration={0.8} scale={0.97}>
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-primary">How it works</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Six steps from folder to shortlist
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Every profile follows the same path, so each candidate is judged in a fair way.
            </p>
          </div>
        </AnimatedContent>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => {
            const Icon = stepIcons[i];
            return (
              <AnimatedContent key={s.n} distance={64} duration={0.75} delay={i * 0.06} scale={0.96}>
                <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/45 hover:shadow-[0_0_0_1px_rgba(225,26,32,0.28),0_18px_50px_-18px_rgba(225,26,32,0.5)]">
                  <span className="pointer-events-none absolute -right-2 -top-3 text-7xl font-extrabold tabular-nums text-primary/[0.07] transition-all duration-300 group-hover:scale-105 group-hover:text-primary/30">
                    {s.n}
                  </span>
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-all duration-300 group-hover:scale-110 group-hover:bg-primary/15">
                    <Icon
                      className="size-5 motion-safe:animate-[medha-float_3.4s_ease-in-out_infinite]"
                      style={{ animationDelay: `${i * 0.25}s` }}
                    />
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </AnimatedContent>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Deliverable mocks --------------------------- */
function DeliverableVisual({ kind }: { kind: (typeof deliverables)[number]["kind"] }) {
  if (kind === "jd") {
    return (
      <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground">Site Engineer, Structural</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Construction, full time, Hyderabad</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Template</span>
        </div>
        <div className="mt-4 space-y-3 text-[11px] leading-relaxed">
          <div>
            <p className="font-semibold text-foreground">Responsibilities</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground marker:text-border">
              <li>Supervise structural work across active towers</li>
              <li>Run quality checks and clear site issues</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-foreground">Requirements</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground marker:text-border">
              <li>B.E. Civil with 4+ years on site</li>
              <li>RCC, QA/QC, and AutoCAD proficiency</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }
  if (kind === "score") {
    const rows = [
      { n: 1, name: "Ananya Sharma", score: 94, w: "94%", bar: "bg-emerald-500" },
      { n: 2, name: "Rahul Verma", score: 88, w: "88%", bar: "bg-emerald-500" },
      { n: 3, name: "Karthik Nair", score: 76, w: "76%", bar: "bg-amber-500" },
    ];
    return (
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">Ranked shortlist</p>
          <span className="text-[10px] text-muted-foreground">Top 3 of 42</span>
        </div>
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-3 border-b border-border/70 py-2.5 last:border-0">
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums", r.n === 1 ? "bg-primary text-white" : "bg-muted text-muted-foreground")}>{r.n}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-foreground">{r.name}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{r.score}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", r.bar)} style={{ width: r.w }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  // interview
  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-xs text-muted-foreground">
        Walk me through a project you led end to end.
      </div>
      <div className="mt-3 ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-primary/10 px-3.5 py-2 text-xs text-foreground">
        I owned the structural QA workflow across three towers, cutting rework by 18 percent.
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          Evaluation: Strong
        </span>
        <span className="text-xs font-bold tabular-nums text-foreground">88</span>
      </div>
    </div>
  );
}

/* -------------------------------- Deliverables ------------------------------ */
function Deliverables() {
  return (
    <section id="deliverables" className="scroll-mt-20 border-y border-border bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <AnimatedContent distance={50} duration={0.8} scale={0.97}>
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-primary">Deliverables</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">What MEDHA delivers</h2>
          </div>
        </AnimatedContent>

        <div className="mt-16 flex flex-col gap-16 sm:gap-24">
          {deliverables.map((d, i) => {
            const flip = i % 2 === 1;
            const Icon = d.icon;
            return (
              <div key={d.kind} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
                <AnimatedContent
                  direction="horizontal"
                  reverse={!flip}
                  distance={90}
                  duration={0.85}
                  className={cn("min-w-0", flip && "lg:order-2")}
                >
                  <div className="relative rounded-3xl border border-border bg-gradient-to-br from-muted/60 to-white p-6 shadow-sm sm:p-9">
                    <div className="absolute -top-4 left-7 flex size-11 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/30">
                      <Icon className="size-5" />
                    </div>
                    <div className="pt-4">
                      <DeliverableVisual kind={d.kind} />
                    </div>
                  </div>
                </AnimatedContent>

                <AnimatedContent
                  direction="horizontal"
                  reverse={flip}
                  distance={64}
                  duration={0.85}
                  delay={0.08}
                  className={cn(flip && "lg:order-1")}
                >
                  <div>
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{d.kicker}</span>
                    <h3 className="mt-4 text-2xl font-bold leading-snug tracking-tight text-foreground sm:text-3xl">
                      {d.text}
                    </h3>
                    <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">{d.desc}</p>
                    <ul className="mt-5 space-y-2.5">
                      {d.points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm text-foreground">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </AnimatedContent>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------ FAQ ----------------------------------- */
function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 bg-white py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <AnimatedContent distance={50} duration={0.8} scale={0.97}>
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="text-sm font-semibold text-primary">FAQ</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Questions, answered</h2>
            <a href="/screening" className={cn(buttonVariants(), "mt-6 inline-flex h-11 rounded-full px-6 text-[15px]")}>
              Get Started
            </a>
          </div>
        </AnimatedContent>

        <AnimatedContent distance={50} duration={0.8} delay={0.1} scale={0.97}>
          <div className="rounded-2xl border border-border bg-card px-6 py-2">
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((f, i) => (
                <AccordionItem key={i} value={`item-${i}`}>
                  <AccordionTrigger className="text-left text-base font-semibold hover:no-underline">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </AnimatedContent>
      </div>
    </section>
  );
}

/* ----------------------------- Social glyphs (inline) ----------------------- */
function IgIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function LiIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6.94 5a1.94 1.94 0 1 1-3.88 0 1.94 1.94 0 0 1 3.88 0ZM3.4 8.6h3.1V21H3.4V8.6Zm5.2 0h2.97v1.7h.04c.41-.78 1.42-1.6 2.93-1.6 3.13 0 3.71 2.06 3.71 4.74V21h-3.1v-5.36c0-1.28-.02-2.92-1.78-2.92-1.78 0-2.05 1.39-2.05 2.83V21H8.6V8.6Z" />
    </svg>
  );
}

/* ----------------------------------- Footer --------------------------------- */
function Footer() {
  return (
    <footer id="contact" className="scroll-mt-20 bg-[#0B0E13] text-slate-300">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.7fr_1fr_1fr_1.1fr]">
          <div>
            <Logo dark />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-slate-400">
              MEDHA is the intelligence behind every hire. Private resume screening, built by My Home Group.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tools</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                ["/jd", "JD Generation"],
                ["/screening", "CV Analyzer"],
                ["/interview", "AI Interview"],
              ].map(([href, label]) => (
                <li key={label}>
                  <a href={href} className="inline-flex items-center gap-1 text-slate-400 transition-colors hover:text-white">
                    {label}
                    <ArrowUpRight className="size-3.5 opacity-60" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Product</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                ["#how", "How it works"],
                ["#deliverables", "Deliverables"],
                ["#faq", "FAQ"],
              ].map(([href, label]) => (
                <li key={label}>
                  <a href={href} className="text-slate-400 transition-colors hover:text-white">{label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Connect</h3>
            <a href="mailto:talent@myhomegroup.in" className="mt-4 inline-block text-sm text-slate-300 transition-colors hover:text-white">
              Get in Touch
            </a>
            <div className="mt-4 flex items-center gap-2.5">
              <a aria-label="Instagram" href="#" className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] text-white transition-transform hover:scale-105">
                <IgIcon className="size-4" />
              </a>
              <a aria-label="LinkedIn" href="#" className="flex size-9 items-center justify-center rounded-xl bg-[#0A66C2] text-white transition-transform hover:scale-105">
                <LiIcon className="size-4" />
              </a>
              <a aria-label="MY HOME GROUP" href="#" className="flex size-9 items-center justify-center rounded-xl bg-white ring-1 ring-white/10 transition-transform hover:scale-105 overflow-hidden px-1">
                <img src="/myhomegroup-logo.png" alt="MY HOME GROUP" className="h-4 w-auto" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-xs text-slate-500">
          &copy; 2026 MEDHA &middot; MY HOME GROUP. Internal talent tooling.
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------ Page ---------------------------------- */
export default function MedhaLanding() {
  // Recalculate scroll-trigger positions once the layout + fonts settle, so the
  // on-scroll reveals fire at the right spots instead of feeling static.
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh();
    const t = window.setTimeout(refresh, 350);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
    window.addEventListener("load", refresh);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("load", refresh);
    };
  }, []);

  return (
    <div className="bg-background text-foreground antialiased">
      <ScrollProgress />
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Deliverables />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
