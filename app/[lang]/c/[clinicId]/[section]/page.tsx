import { notFound } from "next/navigation";

import { ClinicWorkspace } from "../workspace";

export default async function ClinicSectionPage({ params }: PageProps<"/[lang]/c/[clinicId]/[section]">) {
  const { lang, clinicId, section } = await params;
  // The overview lives at the workspace root only.
  if (section === "overview") notFound();
  return <ClinicWorkspace lang={lang} clinicId={clinicId} section={section} />;
}
