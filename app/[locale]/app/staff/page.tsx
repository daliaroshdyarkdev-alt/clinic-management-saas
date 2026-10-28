import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { enterRouteLocale } from "@/i18n/locale";
import {
  changeMemberRole,
  revokeInvitation,
  setManagerStaffPermission,
  setMembershipStatus,
} from "@/modules/staff/actions";
import { getManagerCanManageStaff, getOpenInvitations, getStaff, type StaffMember } from "@/modules/staff/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { InviteForm } from "./invite-form";

const ASSIGNABLE_ROLES = ["manager", "doctor", "receptionist", "cashier"] as const;

export default async function StaffPage({ params }: PageProps<"/[locale]/app/staff">) {
  enterRouteLocale((await params).locale);
  const t = await getTranslations("staff");
  const tr = await getTranslations("shell.roles");
  const format = await getFormatter();
  const workspace = await getWorkspace();
  const clinic = workspace?.active;

  if (!workspace || !clinic || !workspace.capabilities.includes("staff.manage")) {
    return <p className="text-muted-foreground">{t("noAccess")}</p>;
  }

  const isOwner = clinic.role === "owner";
  const [staff, invitations, managerCanManage] = await Promise.all([
    getStaff(clinic.clinicId),
    getOpenInvitations(clinic.clinicId),
    isOwner ? getManagerCanManageStaff(clinic.clinicId) : Promise.resolve(false),
  ]);
  const invitableRoles = isOwner ? ASSIGNABLE_ROLES : ASSIGNABLE_ROLES.filter((r) => r !== "manager");

  // Mirrors the SQL rules so the UI only offers actions that can succeed.
  const canChangeStatus = (m: StaffMember) =>
    m.role !== "owner" && m.user_id !== workspace.user.id && (isOwner || m.role !== "manager");

  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("inviteTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("inviteDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <InviteForm roles={invitableRoles} />
          {invitations.length > 0 ? (
            <div className="grid gap-2">
              <h3 className="text-sm font-medium">{t("openInvitations")}</h3>
              <ul className="divide-y rounded-md border">
                {invitations.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span>
                      <span dir="ltr">{inv.email}</span> · {tr(inv.role)} ·{" "}
                      <span className="text-muted-foreground">
                        {t("expires", { date: format.dateTime(new Date(inv.expires_at), { dateStyle: "medium" }) })}
                      </span>
                    </span>
                    <ActionForm action={revokeInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <SubmitButton size="sm" variant="outline">
                        {t("revoke")}
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t("membersTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-md border">
            {staff.map((m) => (
              <li key={m.id} className="grid gap-3 p-3 text-sm md:grid-cols-[1fr_auto] md:items-start">
                <div>
                  <p className="font-medium">{m.fullName || t("unnamed")}</p>
                  <p className="text-muted-foreground">
                    <span dir="ltr">{m.email}</span> · {tr(m.role)} · {t(`status.${m.status}`)}
                  </p>
                </div>
                {m.status !== "deactivated" && canChangeStatus(m) ? (
                  <div className="flex flex-wrap items-start gap-2">
                    {isOwner ? (
                      <ActionForm action={changeMemberRole} className="flex items-center gap-2">
                        <input type="hidden" name="membershipId" value={m.id} />
                        <label className="sr-only" htmlFor={`role-${m.id}`}>
                          {t("role")}
                        </label>
                        <select
                          id={`role-${m.id}`}
                          name="role"
                          defaultValue={m.role}
                          className="h-8 rounded-md border border-input bg-background px-2"
                        >
                          {ASSIGNABLE_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {tr(role)}
                            </option>
                          ))}
                        </select>
                        <SubmitButton size="sm" variant="outline">
                          {t("changeRole")}
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                    {m.status === "suspended" ? (
                      <ActionForm action={setMembershipStatus}>
                        <input type="hidden" name="membershipId" value={m.id} />
                        <input type="hidden" name="status" value="active" />
                        <SubmitButton size="sm" variant="outline">
                          {t("reactivate")}
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                    <details className="w-full md:w-72">
                      <summary className="cursor-pointer text-destructive">{t("restrictAccess")}</summary>
                      <ActionForm action={setMembershipStatus} className="mt-2">
                        <input type="hidden" name="membershipId" value={m.id} />
                        <label className="text-xs text-muted-foreground" htmlFor={`reason-${m.id}`}>
                          {t("reason")}
                        </label>
                        <Input id={`reason-${m.id}`} name="reason" required maxLength={1000} />
                        <div className="flex flex-wrap gap-2">
                          {m.status === "active" ? (
                            <SubmitButton size="sm" variant="outline" name="status" value="suspended">
                              {t("suspend")}
                            </SubmitButton>
                          ) : null}
                          <SubmitButton size="sm" variant="outline" name="status" value="deactivated">
                            {t("deactivate")}
                          </SubmitButton>
                        </div>
                        <p className="text-xs text-muted-foreground">{t("deactivateHint")}</p>
                      </ActionForm>
                    </details>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg">{t("permissionsTitle")}</h2>
            </CardTitle>
            <CardDescription>{t("permissionsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={setManagerStaffPermission} successText={t("saved")}>
              <input type="hidden" name="allowed" value={managerCanManage ? "false" : "true"} />
              <p className="text-sm">{managerCanManage ? t("managerCanManageStaff") : t("managerCannotManageStaff")}</p>
              <div>
                <SubmitButton size="sm" variant="outline">
                  {managerCanManage ? t("revokeFromManagers") : t("grantToManagers")}
                </SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
