import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { enterRouteLocale } from "@/i18n/locale";
import { getTemplate } from "@/modules/clinical/queries";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { TemplateEditor } from "./template-editor";

/** MED-001: each doctor designs their own consultation form. */
export default async function TemplatePage({ params }: PageProps<"/[locale]/app/doctors/[doctorId]/template">) {
  const { locale, doctorId } = await params;
  enterRouteLocale(locale);
  if (!z.uuid().safeParse(doctorId).success) notFound();
  const t = await getTranslations("template");
  const workspace = await getWorkspace();
  if (workspace?.doctorId !== doctorId) return <p className="text-muted-foreground">{t("ownOnly")}</p>;
  const template = await getTemplate(doctorId);

  return (
    <div className="grid max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">
        {template ? t("version", { version: template.version }) : t("none")}
      </p>
      <TemplateEditor clinicDoctorId={doctorId} initial={template?.fields ?? []} />
    </div>
  );
}
