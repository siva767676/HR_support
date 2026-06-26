import { useEffect, useRef, useState } from "react";
import { Upload, FolderOpen, Files } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Spinner } from "./ui";

/* One uploader for the whole app.
   - variant "dropzone": large drag & drop area + Browse Files / Browse Folder
     buttons (CV Analyzer batch upload, mode "both").
   - variant "compact": a slim dashed click target with busy / selected states
     (AI Interview single-file JD or resume upload).
   Drag & drop works in both variants. Folder selection uses webkitdirectory. */

export function UploadZone({
  mode = "files",
  variant = "dropzone",
  accept,
  multiple = true,
  onFiles,
  title,
  hint,
  icon,
  busy = false,
  busyLabel = "Reading…",
  selected,
  tip,
  className,
}: {
  mode?: "files" | "folder" | "both";
  variant?: "dropzone" | "compact";
  accept: string[];
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title?: string;
  hint?: string;
  icon?: React.ReactNode;
  busy?: boolean;
  busyLabel?: string;
  selected?: React.ReactNode; // compact: render in place of the prompt when a file is chosen
  tip?: React.ReactNode;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  function emit(list: FileList | null) {
    const arr = Array.from(list ?? []).filter((f) => f.size > 0);
    if (arr.length) onFiles(arr);
  }

  function onDragEnter(e: React.DragEvent) { e.preventDefault(); dragCounter.current++; setDragging(true); }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); }
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    emit(e.dataTransfer.files);
  }

  const showFilesBtn = mode === "files" || mode === "both";
  const showFolderBtn = mode === "folder" || mode === "both";
  const acceptStr = accept.join(",");

  const inputs = (
    <>
      <input
        ref={filesRef}
        type="file"
        multiple={multiple}
        accept={acceptStr}
        className="hidden"
        onChange={(e) => { emit(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        accept={acceptStr}
        className="hidden"
        onChange={(e) => { emit(e.target.files); e.target.value = ""; }}
      />
    </>
  );

  /* ── Compact variant (click target with busy / selected states) ── */
  if (variant === "compact") {
    const openPicker = () => (showFolderBtn && !showFilesBtn ? folderRef : filesRef).current?.click();
    return (
      <>
        {inputs}
        <button
          type="button"
          onClick={openPicker}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/50 hover:bg-muted/50",
            className,
          )}
        >
          {busy ? (
            <span className="flex items-center gap-2 text-sm font-medium text-primary"><Spinner /> {busyLabel}</span>
          ) : selected ? (
            selected
          ) : (
            <>
              <span className="text-primary">{icon ?? <Upload className="size-6" />}</span>
              <span className="text-sm font-medium text-foreground">{title ?? "Upload a file"}</span>
              {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </>
          )}
        </button>
      </>
    );
  }

  /* ── Dropzone variant (large drag & drop) ── */
  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "rounded-2xl border-2 border-dashed transition-all duration-200",
        dragging
          ? "border-primary bg-primary/5 shadow-[0_0_0_6px_color-mix(in_oklch,var(--primary)_8%,transparent)]"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/20",
        className,
      )}
    >
      {inputs}
      <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
        <div
          className={cn(
            "mb-5 flex size-16 items-center justify-center rounded-2xl ring-1 ring-inset transition-all",
            dragging ? "bg-primary text-primary-foreground ring-primary/30" : "bg-primary/10 text-primary ring-primary/15",
          )}
        >
          {icon ?? <Upload className="size-7" />}
        </div>

        <p className={cn("text-base font-semibold transition-colors", dragging ? "text-primary" : "text-foreground")}>
          {dragging ? "Release to add files" : title ?? "Drag & drop files here"}
        </p>
        {hint && <p className="mt-1.5 text-sm text-muted-foreground">{hint}</p>}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {showFilesBtn && (
            <Button type="button" variant="outline" onClick={() => filesRef.current?.click()}>
              <Files className="size-4" /> Browse Files
            </Button>
          )}
          {showFolderBtn && (
            <Button type="button" variant="outline" onClick={() => folderRef.current?.click()}>
              <FolderOpen className="size-4" /> Browse Folder
            </Button>
          )}
        </div>

        {tip && (
          <div className="mt-5 flex items-start gap-1.5 rounded-xl bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            <span className="mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground/70">Tip</span>
            <span>{tip}</span>
          </div>
        )}
      </div>
    </div>
  );
}
