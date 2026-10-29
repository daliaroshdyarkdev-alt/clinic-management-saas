import { getTranslations } from "next-intl/server";
import { navItemsFor } from "@/lib/navigation/nav";
import type { ClinicCapability, ClinicRole } from "@/modules/tenancy/active-clinic";
import { NavLink } from "./nav-link";

export async function SideNav({
  role,
  capabilities,
  isDoctor,
}: {
  role: ClinicRole;
  capabilities: readonly ClinicCapability[];
  isDoctor: boolean;
}) {
  const t = await getTranslations("shell");
  const tc = await getTranslations("common");

  return (
    <nav aria-label={t("navigation")} className="flex gap-1 overflow-x-auto md:flex-col">
      {navItemsFor(role, capabilities, { isDoctor }).map((item) =>
        item.milestone === null ? (
          <NavLink key={item.key} href={item.href}>
            {t(`nav.${item.key}`)}
          </NavLink>
        ) : (
          <span
            key={item.key}
            aria-disabled="true"
            className="flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground"
          >
            {t(`nav.${item.key}`)}
            <span className="text-xs">{tc("comingInMilestone", { milestone: item.milestone })}</span>
          </span>
        ),
      )}
    </nav>
  );
}
