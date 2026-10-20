import type { ReactNode } from "react";

/** Request-bound (session) segment: allowed to block so auth redirects keep their HTTP status. */
export const instant = false;

export default function WorkspacesLayout({ children }: { children: ReactNode }) {
  return children;
}
