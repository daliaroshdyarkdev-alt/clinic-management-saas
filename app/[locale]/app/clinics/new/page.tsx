import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { enterRouteLocale } from "@/i18n/locale";
import { getCurrentDisclaimer } from "@/modules/onboarding/queries";
import { ClinicForm } from "./clinic-form";

export default async function NewClinicPage({ params }: PageProps<"/[locale]/app/clinics/new">) {
  const locale = enterRouteLocale((await params).locale);
  const t = await getTranslations("newClinic");
  const disclaimer = await getCurrentDisclaimer();

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl">{t("title")}</h1>
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {disclaimer ? (
          <ClinicForm
            disclaimerVersionId={disclaimer.id}
            disclaimerText={locale === "ar" ? disclaimer.body_ar : disclaimer.body_en}
            isDraft={disclaimer.is_draft}
          />
        ) : (
          <p className="text-destructive">{t("noDisclaimer")}</p>
        )}
      </CardContent>
    </Card>
  );
}
