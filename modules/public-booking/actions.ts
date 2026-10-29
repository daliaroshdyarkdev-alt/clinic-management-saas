"use server";

import { z } from "zod";
import type { DomainErrorCode } from "@/modules/shared/db-errors";
import { respondToOffer, submitBookingRequest } from "./service";

export type PublicState = {
  error: DomainErrorCode | null;
  outcome?: "submitted" | "confirmed" | "unavailable" | "declined";
};

/** APT-001: patient booking request (never a confirmed booking). */
export async function submitRequest(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const [sessionPart, startPart] = String(formData.get("slot") ?? "").split("|");
  const parsed = z
    .object({
      clinicId: z.uuid(),
      sessionId: z.uuid(),
      startsAt: z.iso.datetime({ offset: true }).optional(),
      name: z.string().trim().min(2).max(200),
      phone: z
        .string()
        .trim()
        .regex(/^\+[1-9]\d{6,14}$/),
    })
    .safeParse({
      clinicId: formData.get("clinicId"),
      sessionId: sessionPart,
      startsAt: startPart || undefined,
      name: formData.get("name"),
      phone: formData.get("phone"),
    });
  if (!parsed.success) return { error: "invalid_request" };
  const error = await submitBookingRequest({ ...parsed.data, startsAt: parsed.data.startsAt ?? null });
  return error ? { error } : { error: null, outcome: "submitted" };
}

/** APT-003: patient accepts or declines a proposed alternative. */
export async function answerOffer(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const token = z.string().min(20).max(100).safeParse(formData.get("token"));
  const accept = z.enum(["true", "false"]).safeParse(formData.get("accept"));
  if (!token.success || !accept.success) return { error: "offer_invalid" };
  const result = await respondToOffer(token.data, accept.data === "true");
  return "error" in result ? { error: result.error } : { error: null, outcome: result.outcome };
}
