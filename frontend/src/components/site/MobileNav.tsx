import { useState } from "react";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button";

const links = [
  ["#features", "Features"],
  ["#how", "How it works"],
  ["#faq", "FAQ"],
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open menu"
        className="inline-flex items-center justify-center rounded-md p-2 text-foreground hover:bg-muted md:hidden"
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <nav className="mt-10 flex flex-col gap-1 px-2">
          {links.map(([href, label]) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-base font-medium text-foreground hover:bg-muted"
            >
              {label}
            </a>
          ))}
          <a href="/app" className={`${buttonVariants({ size: "lg" })} mt-3`}>
            Open app
          </a>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
