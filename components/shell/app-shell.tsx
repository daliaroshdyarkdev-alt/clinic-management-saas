import type { ReactNode } from "react";

import { Brand } from "./brand";
import { MobileNav } from "./mobile-nav";
import { NavList } from "./nav-list";
import type { NavItem } from "./types";

/**
 * Authenticated application frame: sidebar on desktop, drawer on smaller
 * screens. Logical properties keep it correct in RTL and LTR.
 */
export function AppShell({
  appName,
  homeHref,
  navItems,
  navLabel,
  menuLabel,
  closeLabel,
  sidebarFooter,
  headerStart,
  headerEnd,
  banner,
  children,
}: {
  appName: string;
  homeHref: string;
  navItems: readonly NavItem[];
  navLabel: string;
  menuLabel: string;
  closeLabel: string;
  sidebarFooter?: ReactNode;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      {banner}
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar lg:flex">
          <div className="flex h-16 items-center px-5">
            <Brand name={appName} href={homeHref} />
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <NavList items={navItems} label={navLabel} />
          </div>
          {sidebarFooter ? <div className="border-t border-sidebar-border p-4">{sidebarFooter}</div> : null}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur sm:px-6">
            <MobileNav title={appName} menuLabel={menuLabel} closeLabel={closeLabel}>
              <NavList items={navItems} label={navLabel} />
              {sidebarFooter ? <div className="mt-6 border-t pt-4">{sidebarFooter}</div> : null}
            </MobileNav>
            {/* Phones: the workspace controls get their own full-width row. */}
            <div className="order-last flex min-w-0 basis-full items-center gap-2 sm:order-none sm:flex-1 sm:basis-auto">
              {headerStart}
            </div>
            <div className="ms-auto flex items-center gap-1">{headerEnd}</div>
          </header>
          <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
