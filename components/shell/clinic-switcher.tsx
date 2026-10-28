"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { switchClinic } from "@/modules/tenancy/actions";

type Option = { clinicId: string; name: string };

export function ClinicSwitcher({ clinics, activeClinicId }: { clinics: Option[]; activeClinicId: string }) {
  const t = useTranslations("shell");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (clinics.length < 2) {
    return <span className="truncate font-medium">{clinics[0]?.name}</span>;
  }

  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="sr-only">{t("switchClinic")}</span>
      <select
        className="h-9 min-w-0 max-w-56 truncate rounded-md border border-input bg-background px-2 font-medium"
        value={activeClinicId}
        disabled={pending}
        onChange={(event) => {
          const clinicId = event.target.value;
          startTransition(async () => {
            const result = await switchClinic(clinicId);
            // Server-rendered data is re-fetched for the new clinic; the shell
            // below is keyed by clinic id so no client state carries over.
            if (result.ok) router.refresh();
          });
        }}
      >
        {clinics.map((clinic) => (
          <option key={clinic.clinicId} value={clinic.clinicId}>
            {clinic.name}
          </option>
        ))}
      </select>
    </label>
  );
}
