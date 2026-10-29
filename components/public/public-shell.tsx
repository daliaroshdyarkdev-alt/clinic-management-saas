import type { ReactNode } from "react";
import { DevNotice } from "@/components/shell/dev-notice";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <DevNotice />
      <div className="flex justify-end px-4 py-3 sm:px-8">
        <LocaleSwitcher />
      </div>
      <main className="mx-auto grid w-full max-w-xl flex-1 content-start gap-4 px-4 py-6">{children}</main>
    </div>
  );
}
