"use client";

import { Menu } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Navigation drawer for phones and tablets. It opens from the reading-start edge. */
export function MobileNav({
  title,
  menuLabel,
  closeLabel,
  children,
}: {
  title: string;
  menuLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Close the drawer when a link inside it is followed.
  const closeOnLink = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={menuLabel}
          data-testid="mobile-nav-trigger"
        >
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="start" closeLabel={closeLabel} aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-3 pb-6" onClickCapture={closeOnLink}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
