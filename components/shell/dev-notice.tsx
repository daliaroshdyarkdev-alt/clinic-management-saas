import { getTranslations } from "next-intl/server";

export async function DevNotice() {
  const t = await getTranslations("common");
  return (
    <p role="note" className="bg-warning px-4 py-1.5 text-center text-xs text-warning-foreground">
      {t("devNotice")}
    </p>
  );
}
