import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { addDoctor, setOnlineBooking } from "@/modules/scheduling/actions";
import { getClinicDoctors, getDoctorCandidates, getOnlineBookingEnabled } from "@/modules/scheduling/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function DoctorsPage({ params }: PageProps<"/[locale]/app/doctors">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("doctors");
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic) return null;
  const isOwner = clinic.role === "owner";
  if (!isOwner && !workspace.doctorId) return <p className="text-muted-foreground">{t("noAccess")}</p>;

  const doctors = await getClinicDoctors(clinic.clinicId);
  const visible = isOwner ? doctors : doctors.filter((d) => d.id === workspace.doctorId);
  const [candidates, onlineBooking] = isOwner
    ? await Promise.all([getDoctorCandidates(clinic.clinicId), getOnlineBookingEnabled(clinic.clinicId)])
    : [[], false];
  const addable = candidates.filter((c) => !doctors.some((d) => d.user_id === c.userId));

  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <ul className="divide-y rounded-md border">
        {visible.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div>
              <p className="font-medium">{d.display_name}</p>
              <p className="text-muted-foreground">
                {d.specialty ? `${d.specialty} · ` : ""}
                {d.policy ? t(`method.${d.policy.method}`) : t("notConfigured")}
                {d.status === "inactive" ? ` · ${t("inactive")}` : ""}
              </p>
            </div>
            <Link href={`/app/doctors/${d.id}`} className="text-primary underline-offset-4 hover:underline">
              {t("configure")}
            </Link>
          </li>
        ))}
        {visible.length === 0 ? <li className="p-3 text-sm text-muted-foreground">{t("none")}</li> : null}
      </ul>

      {isOwner ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">{t("addTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("addDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {addable.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noCandidates")}</p>
              ) : (
                <ActionForm action={addDoctor} className="sm:grid-cols-3 sm:items-end">
                  <label className="grid gap-1 text-sm">
                    {t("member")}
                    <select
                      name="membershipId"
                      required
                      className="h-9 rounded-md border border-input bg-background px-2"
                    >
                      {addable.map((c) => (
                        <option key={c.membershipId} value={c.membershipId}>
                          {c.name || c.userId.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    {t("displayName")}
                    <Input name="displayName" required minLength={2} maxLength={200} />
                  </label>
                  <label className="grid gap-1 text-sm">
                    {t("specialty")}
                    <Input name="specialty" maxLength={200} />
                  </label>
                  <div>
                    <SubmitButton>{t("add")}</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">{t("onlineTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("onlineDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p>{onlineBooking ? t("onlineOn") : t("onlineOff")}</p>
              {onlineBooking ? (
                <p>
                  {t("publicLink")}:{" "}
                  <code dir="ltr" className="select-all break-all text-xs">{`/book/${clinic.clinicId}`}</code>
                </p>
              ) : null}
              <ActionForm action={setOnlineBooking}>
                <input type="hidden" name="enabled" value={onlineBooking ? "false" : "true"} />
                <div>
                  <SubmitButton size="sm" variant="outline">
                    {onlineBooking ? t("turnOff") : t("turnOn")}
                  </SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
