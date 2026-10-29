import { getTranslations } from "next-intl/server";
import { NavLink } from "@/components/shell/nav-link";
import type { ClinicCapability } from "@/modules/tenancy/active-clinic";

export async function FinanceNav({
  capabilities,
  isOwner,
}: {
  capabilities: readonly ClinicCapability[];
  isOwner: boolean;
}) {
  const t = await getTranslations("finance.nav");
  const has = (c: ClinicCapability) => capabilities.includes(c);
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-1 border-b pb-2">
      {has("finance.collect") ? <NavLink href="/app/finance">{t("desk")}</NavLink> : null}
      {has("finance.approve") || isOwner ? <NavLink href="/app/finance/approvals">{t("approvals")}</NavLink> : null}
      {has("finance.reports") || has("finance.approve") ? (
        <NavLink href="/app/finance/ledger">{t("ledger")}</NavLink>
      ) : null}
      {has("finance.accounts") || isOwner ? <NavLink href="/app/finance/setup">{t("setup")}</NavLink> : null}
    </nav>
  );
}
