import { Building2, ClipboardCheck, PauseCircle, ShieldAlert, Timer } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { demoAdminStats, demoVerifications } from "@/lib/demo/fixtures";
import type { Locale } from "@/lib/i18n/config";
import { interpolate, type Dictionary } from "@/lib/i18n/dictionaries";
import { formatClinicDate, formatNumber } from "@/lib/time/cairo";

import { StatCard } from "./stat-card";

/** Platform admin overview with SYNTHETIC operational data only (ADM-001, ADM-003). */
export function AdminDashboardPreview({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const a = dict.admin;
  const n = (value: number) => formatNumber(value, locale);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{a.title}</h1>

      <Alert variant="info" data-testid="admin-restriction">
        <ShieldAlert aria-hidden />
        <AlertTitle>{a.restrictionTitle}</AlertTitle>
        <AlertDescription>{a.restrictionBody}</AlertDescription>
      </Alert>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4">
        <StatCard label={a.pendingVerifications} value={n(demoVerifications.length)} icon={ClipboardCheck} />
        <StatCard label={a.activeClinics} value={n(demoAdminStats.active)} icon={Building2} />
        <StatCard label={a.suspendedClinics} value={n(demoAdminStats.suspended)} icon={PauseCircle} />
        <StatCard label={a.trialsEnding} value={n(demoAdminStats.trialsEnding)} icon={Timer} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{a.queueTitle}</CardTitle>
          <CardDescription>{dict.common.syntheticData}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{a.clinic}</TableHead>
                <TableHead>{a.submitted}</TableHead>
                <TableHead>{a.documents}</TableHead>
                <TableHead>{a.state}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {demoVerifications.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.clinic[locale]}</TableCell>
                  <TableCell>{formatClinicDate(row.submittedAtUtc, locale)}</TableCell>
                  <TableCell>{interpolate(a.documentsCount, { n: n(row.documents) })}</TableCell>
                  <TableCell>
                    <Badge variant={row.state === "documents_requested" ? "warning" : "info"}>
                      {dict.clinicStates[row.state]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
