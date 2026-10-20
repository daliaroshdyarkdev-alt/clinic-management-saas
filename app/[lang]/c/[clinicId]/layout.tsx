import type { ReactNode } from "react";

/** Request-bound (session + membership) segment; see workspaces/layout.tsx. */
export const instant = false;

export default function ClinicLayout({ children }: { children: ReactNode }) {
  return children;
}
