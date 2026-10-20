import type { ReactNode } from "react";

/**
 * Preview pages are prerendered for every synthetic clinic/role (see
 * generateStaticParams). Other param values may block and resolve to 404.
 */
export const instant = false;

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return children;
}
