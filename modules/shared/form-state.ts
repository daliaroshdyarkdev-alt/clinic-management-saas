import type { DomainErrorCode } from "./db-errors";

/** State returned by simple server-action forms. */
export type ActionState = { error: DomainErrorCode | null; done?: boolean; link?: string };
