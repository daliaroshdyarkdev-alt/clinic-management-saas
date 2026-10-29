import "server-only";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { toDomainError, type DomainErrorCode } from "@/modules/shared/db-errors";

const optionsSchema = z.object({
  clinic_name: z.string(),
  doctors: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      specialty: z.string().nullable(),
      sessions: z.array(
        z.object({
          id: z.uuid(),
          method: z.enum(["timed", "queue"]),
          starts_at: z.string(),
          ends_at: z.string(),
          remaining: z.number().nullable(),
          free_slots: z.array(z.string()),
        }),
      ),
    }),
  ),
});

export type BookingOptions = z.infer<typeof optionsSchema>;

/** Public booking page data; null when the clinic does not take online requests. */
export async function getBookingOptions(clinicId: string): Promise<BookingOptions | null> {
  const { data, error } = await createSupabaseServiceClient().rpc("public_booking_options", {
    p_clinic_id: clinicId,
    p_days: 14,
  });
  if (error) throw new Error("Failed to load booking options");
  return data === null ? null : optionsSchema.parse(data);
}

export async function submitBookingRequest(input: {
  clinicId: string;
  sessionId: string;
  startsAt: string | null;
  name: string;
  phone: string;
  whatsappConsent: boolean;
}): Promise<DomainErrorCode | null> {
  const { error } = await createSupabaseServiceClient().rpc("public_submit_booking_request", {
    p_clinic_id: input.clinicId,
    p_session_id: input.sessionId,
    p_starts_at: input.startsAt,
    p_name: input.name,
    p_phone_e164: input.phone,
    p_whatsapp_consent: input.whatsappConsent,
  });
  return error ? toDomainError(error) : null;
}

const offerSchema = z.object({
  status: z.enum(["offered", "accepted", "declined", "unavailable", "withdrawn"]),
  clinic_name: z.string(),
  doctor_name: z.string(),
  method: z.enum(["timed", "queue"]),
  session_starts_at: z.string(),
  session_ends_at: z.string(),
  starts_at: z.string().nullable(),
});

export type PublicOffer = z.infer<typeof offerSchema>;

export async function getOffer(token: string): Promise<PublicOffer | null> {
  const { data, error } = await createSupabaseServiceClient().rpc("public_get_offer", { p_token: token }).maybeSingle();
  if (error) throw new Error("Failed to load offer");
  return data ? offerSchema.parse(data) : null;
}

export async function respondToOffer(
  token: string,
  accept: boolean,
): Promise<{ outcome: "confirmed" | "unavailable" | "declined" } | { error: DomainErrorCode }> {
  const { data, error } = await createSupabaseServiceClient().rpc("public_respond_to_offer", {
    p_token: token,
    p_accept: accept,
  });
  if (error) return { error: toDomainError(error) };
  return { outcome: z.enum(["confirmed", "unavailable", "declined"]).parse(data) };
}
