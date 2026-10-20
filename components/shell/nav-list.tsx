import Link from "next/link";

import { cn } from "@/lib/utils";

import { adminSectionIcons, clinicSectionIcons } from "./nav-icons";
import type { NavItem } from "./types";

const allIcons = { ...clinicSectionIcons, ...adminSectionIcons };

export function NavList({ items, label }: { items: readonly NavItem[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = allIcons[item.key as keyof typeof allIcons];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                data-nav-key={item.key}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  item.active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
                <span className="truncate">{item.label}</span>
                {item.plannedMilestone ? (
                  <span className="ms-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground tabular-nums">
                    M{item.plannedMilestone}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
