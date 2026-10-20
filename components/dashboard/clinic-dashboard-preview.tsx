import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  Clock,
  Inbox,
  ListOrdered,
  Lock,
  MessageCircle,
  Wallet,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { demoAppointments, demoStats, type DemoAppointmentStatus, type DemoClinic } from "@/lib/demo/fixtures";
import type { Locale } from "@/lib/i18n/config";
import { interpolate, type Dictionary } from "@/lib/i18n/dictionaries";
import { formatEgp } from "@/lib/money/egp";
import { formatClinicTime, formatNumber } from "@/lib/time/cairo";
import type { Capability, ClinicRole } from "@/modules/permissions/capabilities";

import { StatCard } from "./stat-card";

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>["variant"];

const statusVariant: Record<DemoAppointmentStatus, BadgeVariant> = {
  confirmed: "info",
  checked_in: "warning",
  in_consultation: "default",
  completed: "success",
  no_show: "destructive",
};

/**
 * Overview with SYNTHETIC data (ADR-0005). Every widget is gated by the same
 * capabilities the real dashboard will use. No widget shows medical content.
 */
export function ClinicDashboardPreview({
  dict,
  locale,
  clinic,
  role,
  capabilitySet,
}: {
  dict: Dictionary;
  locale: Locale;
  clinic: DemoClinic;
  role: ClinicRole;
  capabilitySet: ReadonlySet<Capability>;
}) {
  const d = dict.dashboard;
  const n = (value: number) => formatNumber(value, locale);
  const clinicWide = capabilitySet.has("appointments.manage");
  const ownOnly = !clinicWide && capabilitySet.has("appointments.own");
  // A doctor sees only their own list (synthetic "Doctor A" stands in for the signed-in doctor).
  const appointments = ownOnly ? demoAppointments.filter((a) => a.doctorKey === "a") : demoAppointments;
  const waiting = appointments.filter((a) => a.status === "checked_in").length;

  if (clinic.state !== "active") {
    return <OnboardingStatus dict={dict} clinic={clinic} />;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {d.welcome} · {dict.roles[role]}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{clinic.name[locale]}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">{dict.clinicStates[clinic.state]}</Badge>
          {clinic.trialDaysLeft !== null ? (
            <Badge variant="outline">{interpolate(d.trialDaysLeft, { n: n(clinic.trialDaysLeft) })}</Badge>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4" data-testid="stat-grid">
        {clinicWide || ownOnly ? (
          <StatCard
            label={ownOnly ? d.myAppointmentsToday : d.todayAppointments}
            value={n(appointments.length)}
            icon={CalendarClock}
            testId="stat-appointments"
          />
        ) : null}
        {clinicWide ? (
          <StatCard
            label={d.pendingRequests}
            value={n(demoStats.pendingRequests)}
            icon={Inbox}
            testId="stat-requests"
          />
        ) : null}
        {capabilitySet.has("queue.manage") || ownOnly ? (
          <StatCard label={d.waitingQueue} value={n(waiting)} icon={ListOrdered} testId="stat-queue" />
        ) : null}
        {capabilitySet.has("finance.view") ? (
          <StatCard
            label={d.collectionsToday}
            value={formatEgp(demoStats.collectionsToday, locale)}
            icon={Wallet}
            testId="stat-collections"
          />
        ) : null}
        {capabilitySet.has("finance.cashier") && !capabilitySet.has("finance.view") ? (
          <StatCard label={d.cashierSession} value={d.cashierOpen} icon={Clock} testId="stat-cashier" />
        ) : null}
        {capabilitySet.has("whatsapp.budget.manage") ? (
          <StatCard
            label={d.whatsappUsage}
            value={`${n(demoStats.whatsappUsed)} / ${n(demoStats.whatsappAllowance)}`}
            icon={MessageCircle}
            testId="stat-whatsapp"
          />
        ) : null}
      </div>

      {clinicWide || ownOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>{d.schedule}</CardTitle>
            <CardDescription>{dict.common.syntheticData}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table data-testid="schedule-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{d.time}</TableHead>
                  <TableHead>{d.patient}</TableHead>
                  {ownOnly ? null : <TableHead>{d.doctor}</TableHead>}
                  <TableHead>{d.booking}</TableHead>
                  <TableHead>{d.status}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.map((appointment) => (
                  <TableRow key={appointment.id}>
                    <TableCell className="tabular-nums">{formatClinicTime(appointment.startsAtUtc, locale)}</TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {appointment.patientCode}
                    </TableCell>
                    {ownOnly ? null : <TableCell>{appointment.doctor[locale]}</TableCell>}
                    <TableCell>
                      {appointment.booking.kind === "timed"
                        ? d.timed
                        : interpolate(d.queueNumber, { n: n(appointment.booking.number) })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[appointment.status]}>{d.statuses[appointment.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Alert variant="info">
        <Lock aria-hidden />
        <AlertDescription>{d.medicalNotice}</AlertDescription>
      </Alert>
    </div>
  );
}

function OnboardingStatus({ dict, clinic }: { dict: Dictionary; clinic: DemoClinic }) {
  const d = dict.dashboard;
  const steps = [
    { key: "profile", label: d.onboardingSteps.profile, status: "done" },
    { key: "licenses", label: d.onboardingSteps.licenses, status: "done" },
    { key: "review", label: d.onboardingSteps.review, status: "inProgress" },
    { key: "activation", label: d.onboardingSteps.activation, status: "todo" },
  ] as const;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-testid="onboarding-status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{d.onboardingTitle}</h1>
        <Badge variant="warning">{dict.clinicStates[clinic.state]}</Badge>
      </div>
      <Alert variant="warning">
        <Lock aria-hidden />
        <AlertDescription>{d.onboardingBody}</AlertDescription>
      </Alert>
      <Card>
        <CardContent>
          <ol className="flex flex-col gap-4">
            {steps.map((step) => (
              <li key={step.key} className="flex items-center gap-3">
                {step.status === "done" ? (
                  <CircleCheck className="size-5 text-success" aria-hidden />
                ) : step.status === "inProgress" ? (
                  <Clock className="size-5 text-warning-foreground" aria-hidden />
                ) : (
                  <CircleDashed className="size-5 text-muted-foreground" aria-hidden />
                )}
                <span className="flex-1 text-sm font-medium">{step.label}</span>
                <span className="text-xs text-muted-foreground">{d[step.status]}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
