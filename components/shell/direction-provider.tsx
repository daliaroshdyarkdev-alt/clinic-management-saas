"use client";

import { Direction } from "radix-ui";
import type { ReactNode } from "react";

/** Makes Radix primitives (menus, dialogs) position and navigate correctly in RTL. */
export function DirectionProvider({ dir, children }: { dir: "rtl" | "ltr"; children: ReactNode }) {
  return <Direction.Provider dir={dir}>{children}</Direction.Provider>;
}
