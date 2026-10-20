import type { Dictionary } from "@/lib/i18n/dictionaries";

import { Disclaimer } from "./disclaimer";

export function PublicFooter({ dict }: { dict: Dictionary }) {
  return (
    <footer className="border-t bg-muted/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 sm:px-6">
        <p className="text-sm font-medium">
          {dict.common.appName} · {dict.common.tagline}
        </p>
        <Disclaimer dict={dict} />
      </div>
    </footer>
  );
}
