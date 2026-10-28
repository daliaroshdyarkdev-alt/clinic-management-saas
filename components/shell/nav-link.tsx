"use client";

import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
    >
      {children}
    </Link>
  );
}
