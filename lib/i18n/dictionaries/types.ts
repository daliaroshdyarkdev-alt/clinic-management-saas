import type { ar } from "./ar";

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { readonly [K in keyof T]: Widen<T[K]> };

/** Every locale must provide exactly the Arabic dictionary's shape. */
export type Dictionary = Widen<typeof ar>;
