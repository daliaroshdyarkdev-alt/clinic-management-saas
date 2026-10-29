import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("errorPage");
  return (
    <main className="mx-auto grid max-w-lg gap-3 p-6">
      <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground">{t("notFoundBody")}</p>
      <Link href="/" className="underline">
        {t("home")}
      </Link>
    </main>
  );
}
