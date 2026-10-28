import "server-only";
import { cookies } from "next/headers";
import { ACTIVE_CLINIC_COOKIE } from "./active-clinic";

/** Only call after the membership was verified for the current user. */
export async function setActiveClinicCookie(clinicId: string): Promise<void> {
  (await cookies()).set(ACTIVE_CLINIC_COOKIE, clinicId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
