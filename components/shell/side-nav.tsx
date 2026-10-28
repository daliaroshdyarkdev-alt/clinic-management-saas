import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { navItemsFor } from "@/lib/navigation/nav";
import type { ClinicRole } from "@/lib/tenancy/active-clinic";

export async function SideNav({ role }: { role: ClinicRole }) {
  const t = await getTranslations("shell");
  const tc = await getTranslations("common");

  return (
    <nav aria-label={t("navigation")} className="flex gap-1 overflow-x-auto md:flex-col">
      {navItemsFor(role).map((item) =>
        item.milestone === null ? (
          <Link
            key={item.key}
            href={item.href}
            className="whitespace-nowrap rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
          >
            {t(`nav.${item.key}`)}
          </Link>
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
