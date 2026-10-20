import type { ReactNode } from "react";

/** Request-bound (session + platform-admin check) segment; see workspaces/layout.tsx. */
export const instant = false;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
