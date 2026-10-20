import { demoClinics, demoRoles } from "@/lib/demo/fixtures";

import { PreviewClinicFrame } from "../../../frames";

export function generateStaticParams() {
  return demoClinics.flatMap((clinic) => demoRoles.map((role) => ({ clinicId: clinic.id, role })));
}

export default async function PreviewClinicPage({ params }: PageProps<"/[lang]/preview/c/[clinicId]/[role]">) {
  const { lang, clinicId, role } = await params;
  return <PreviewClinicFrame lang={lang} clinicId={clinicId} role={role} section="overview" />;
}
