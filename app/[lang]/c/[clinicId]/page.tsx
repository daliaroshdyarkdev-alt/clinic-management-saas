import { ClinicWorkspace } from "./workspace";

export default async function ClinicOverviewPage({ params }: PageProps<"/[lang]/c/[clinicId]">) {
  const { lang, clinicId } = await params;
  return <ClinicWorkspace lang={lang} clinicId={clinicId} section="overview" />;
}
