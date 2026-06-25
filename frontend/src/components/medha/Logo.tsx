import { cn } from "@/lib/utils";

/** Official MY HOME GROUP logo lockup + MEDHA product wordmark. */
export default function Logo({ dark = false, className }: { dark?: boolean; className?: string }) {
  return (
    <a
      href="#top"
      aria-label="MEDHA by MY HOME GROUP, back to top"
      className={cn("inline-flex items-center gap-2.5 leading-none", className)}
    >
      <span className="inline-flex items-center rounded-md bg-white px-2 py-1 shadow-sm ring-1 ring-black/5">
        <img
          src="/myhomegroup-logo.png"
          alt="MY HOME GROUP"
          width={182}
          height={105}
          className="h-7 w-auto"
        />
      </span>
      <span className={cn("text-[19px] font-extrabold tracking-[0.02em]", dark ? "text-white" : "text-foreground")}>
        MEDHA
      </span>
    </a>
  );
}
