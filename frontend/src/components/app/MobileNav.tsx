import { useState } from "react";
import { Menu, FileText, ScanSearch, Bot, Home } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/* Mobile navigation drawer for the app console. The desktop sidebar is rendered
   statically by App.astro; this island provides the only interactive piece — the
   hamburger + slide-in drawer shown below the lg breakpoint. Icons are mapped from
   a serializable key string because Astro can't pass React components as props. */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  jd: FileText,
  screening: ScanSearch,
  interview: Bot,
};

type NavLink = { key: string; label: string; href: string };

export default function MobileNav({
  active,
  links,
}: {
  active: string;
  links: NavLink[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className="inline-flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-72 border-r-0 bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>

        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <span className="inline-flex items-center rounded-md bg-white px-2 py-1 shadow-sm ring-1 ring-black/5">
            <img src="/myhomegroup-logo.png" alt="MY HOME GROUP" className="h-7 w-auto" />
          </span>
          <span className="text-[19px] font-extrabold tracking-[0.02em] text-white">MEDHA</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          {links.map((l) => {
            const Icon = ICONS[l.key] ?? FileText;
            const isActive = active === l.key;
            return (
              <a
                key={l.key}
                href={l.href}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                {l.label}
              </a>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-sidebar-border px-3 py-3">
          <a
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Home className="size-[18px] shrink-0" />
            Back to home
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
