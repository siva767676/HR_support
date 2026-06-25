import { Fragment } from "react";

/** Minimal Markdown renderer for JD bodies: headings, bold, bullet/numbered
 * lists, rules, and paragraphs. Table rows (the auto-added header block) are
 * skipped — the metadata is shown separately by the caller. No dependency. */

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export default function Markdown({ md, className = "" }: { md: string; className?: string }) {
  const out: React.ReactNode[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    out.push(
      list.type === "ul" ? (
        <ul key={`l${out.length}`} className="ml-5 list-disc space-y-1 text-muted-foreground marker:text-primary/50">{items}</ul>
      ) : (
        <ol key={`l${out.length}`} className="ml-5 list-decimal space-y-1 text-muted-foreground marker:text-muted-foreground">{items}</ol>
      ),
    );
    list = null;
  };

  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("|")) continue; // skip table rows
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      out.push(<h3 key={`h${out.length}`} className="mt-4 text-base font-bold text-foreground first:mt-0">{inline(line.replace(/^#{1,6}\s+/, ""))}</h3>);
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)/);
    const ol = line.match(/^\d+\.\s+(.*)/);
    if (ul) {
      if (list?.type !== "ul") { flush(); list = { type: "ul", items: [] }; }
      list.items.push(ul[1]);
      continue;
    }
    if (ol) {
      if (list?.type !== "ol") { flush(); list = { type: "ol", items: [] }; }
      list.items.push(ol[1]);
      continue;
    }
    flush();
    if (line === "") continue;
    if (/^-{3,}$/.test(line)) { out.push(<hr key={`r${out.length}`} className="my-3 border-border" />); continue; }
    out.push(<p key={`p${out.length}`} className="leading-relaxed text-muted-foreground">{inline(line)}</p>);
  }
  flush();

  return <div className={`space-y-2 text-sm ${className}`}>{out}</div>;
}
