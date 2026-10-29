import { getTranslations } from "next-intl/server";
import { FinanceNav } from "@/components/finance/finance-nav";
import { getWorkspace } from "@/modules/tenancy/workspace";

export default async function FinanceLayout({ children }: LayoutProps<"/[locale]/app/finance">) {
  const t = await getTranslations("finance");
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!workspace || !clinic || !workspace.capabilities.some((c) => c.startsWith("finance."))) {
    return <p className="text-muted-foreground">{t("noAccess")}</p>;
  }
  return (
    <div className="grid max-w-5xl gap-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <FinanceNav capabilities={workspace.capabilities} isOwner={clinic.role === "owner"} />
      {children}
    </div>
  );
}
