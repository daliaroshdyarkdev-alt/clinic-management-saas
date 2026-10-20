/**
 * SYNTHETIC preview data (ADR-0005). No real people, clinics or records.
 * Patient labels are generated codes, not names. Timestamps are fixed so
 * pages prerender deterministically.
 */
import { piasters, type Piasters } from "@/lib/money/egp";
import type { ClinicRole } from "@/modules/permissions/capabilities";
import { clinicRoles } from "@/modules/permissions/capabilities";
import type { ClinicAccountState, ClinicMembership } from "@/modules/tenancy/types";

export type DemoClinic = {
  id: string;
  name: { ar: string; en: string };
  state: ClinicAccountState;
  trialDaysLeft: number | null;
};

export const demoClinics: readonly DemoClinic[] = [
  {
    id: "0b9c6f2e-1d3a-4c5b-8e7f-a1b2c3d4e5f6",
    name: { ar: "عيادة النخبة التجريبية", en: "Demo Elite Clinic" },
    state: "active",
    trialDaysLeft: 9,
  },
  {
    id: "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c",
    name: { ar: "مركز الأسنان التجريبي", en: "Demo Dental Center" },
    state: "active",
    trialDaysLeft: null,
  },
  {
    id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    name: { ar: "عيادة قيد التسجيل", en: "Demo Clinic (Onboarding)" },
    state: "pending_verification",
    trialDaysLeft: null,
  },
];

export function findDemoClinic(id: string): DemoClinic | undefined {
  return demoClinics.find((clinic) => clinic.id === id);
}

/** Preview memberships: the preview user holds the selected role in every demo clinic. */
export function demoMemberships(role: ClinicRole, locale: "ar" | "en"): ClinicMembership[] {
  return demoClinics.map((clinic) => ({
    clinicId: clinic.id,
    clinicName: clinic.name[locale],
    clinicState: clinic.state,
    status: "active",
    roles: [role],
    grants: [],
  }));
}

export const demoRoles: readonly ClinicRole[] = clinicRoles;

export type DemoAppointmentStatus = "confirmed" | "checked_in" | "in_consultation" | "completed" | "no_show";

export type DemoAppointment = {
  id: string;
  startsAtUtc: string;
  patientCode: string;
  doctor: { ar: string; en: string };
  doctorKey: "a" | "b";
  booking: { kind: "timed" } | { kind: "queue"; number: number };
  status: DemoAppointmentStatus;
};

const doctorA = { ar: "د. طبيب تجريبي (أ)", en: "Dr. Demo Doctor A" };
const doctorB = { ar: "د. طبيب تجريبي (ب)", en: "Dr. Demo Doctor B" };

/** 20 Oct 2026, Cairo is UTC+3 (DST) on this date. */
export const demoAppointments: readonly DemoAppointment[] = [
  {
    id: "a1",
    startsAtUtc: "2026-10-20T06:00:00Z",
    patientCode: "PT-0001",
    doctor: doctorA,
    doctorKey: "a",
    booking: { kind: "timed" },
    status: "completed",
  },
  {
    id: "a2",
    startsAtUtc: "2026-10-20T06:30:00Z",
    patientCode: "PT-0002",
    doctor: doctorA,
    doctorKey: "a",
    booking: { kind: "timed" },
    status: "no_show",
  },
  {
    id: "a3",
    startsAtUtc: "2026-10-20T07:00:00Z",
    patientCode: "PT-0003",
    doctor: doctorA,
    doctorKey: "a",
    booking: { kind: "timed" },
    status: "in_consultation",
  },
  {
    id: "a4",
    startsAtUtc: "2026-10-20T07:30:00Z",
    patientCode: "PT-0004",
    doctor: doctorA,
    doctorKey: "a",
    booking: { kind: "timed" },
    status: "checked_in",
  },
  {
    id: "b1",
    startsAtUtc: "2026-10-20T14:00:00Z",
    patientCode: "PT-0005",
    doctor: doctorB,
    doctorKey: "b",
    booking: { kind: "queue", number: 1 },
    status: "checked_in",
  },
  {
    id: "b2",
    startsAtUtc: "2026-10-20T14:00:00Z",
    patientCode: "PT-0006",
    doctor: doctorB,
    doctorKey: "b",
    booking: { kind: "queue", number: 2 },
    status: "confirmed",
  },
  {
    id: "b3",
    startsAtUtc: "2026-10-20T14:00:00Z",
    patientCode: "PT-0007",
    doctor: doctorB,
    doctorKey: "b",
    booking: { kind: "queue", number: 3 },
    status: "confirmed",
  },
];

export const demoStats: {
  pendingRequests: number;
  collectionsToday: Piasters;
  whatsappUsed: number;
  whatsappAllowance: number;
} = {
  pendingRequests: 4,
  collectionsToday: piasters(1_250_000), // 12,500 EGP
  whatsappUsed: 312,
  whatsappAllowance: 500,
};

export type DemoVerification = {
  id: string;
  clinic: { ar: string; en: string };
  submittedAtUtc: string;
  documents: number;
  state: ClinicAccountState;
};

export const demoVerifications: readonly DemoVerification[] = [
  {
    id: "v1",
    clinic: { ar: "عيادة تجريبية ١", en: "Demo Clinic 1" },
    submittedAtUtc: "2026-10-19T09:15:00Z",
    documents: 2,
    state: "pending_verification",
  },
  {
    id: "v2",
    clinic: { ar: "عيادة تجريبية ٢", en: "Demo Clinic 2" },
    submittedAtUtc: "2026-10-18T12:40:00Z",
    documents: 3,
    state: "documents_requested",
  },
  {
    id: "v3",
    clinic: { ar: "عيادة تجريبية ٣", en: "Demo Clinic 3" },
    submittedAtUtc: "2026-10-17T16:05:00Z",
    documents: 2,
    state: "pending_verification",
  },
];

export const demoAdminStats = { active: 128, suspended: 3, trialsEnding: 7 };
