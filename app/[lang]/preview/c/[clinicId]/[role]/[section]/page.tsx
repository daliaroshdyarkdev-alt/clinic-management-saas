import { notFound } from "next/navigation";

import { findDemoClinic } from "@/lib/demo/fixtures";
import { effectiveCapabilities, isClinicRole } from "@/modules/permissions/capabilities";
import { buildClinicNavigation } from "@/modules/permissions/navigation";

import { PreviewClinicFrame } from "../../../../frames";

/** Prerender only sections the synthetic role can see; anything else renders on demand as a 404. */
export function generateStaticParams({ params }: { params: { clinicId: string; role: string } }) {
  const clinic = findDemoClinic(params.clinicId);
  const sections =
    clinic && isClinicRole(params.role)
      ? buildClinicNavigation(effectiveCapabilities([params.role]), clinic.state).filter((s) => s !== "overview")
      : [];
  // Cache Components needs at least one param per parent. "overview" is rejected
  // by the page below, so this placeholder only ever prerenders the 404 page.
  return sections.length > 0 ? sections.map((section) => ({ section })) : [{ section: "overview" }];
}

export default async function PreviewClinicSectionPage({
  params,
}: PageProps<"/[lang]/preview/c/[clinicId]/[role]/[section]">) {
  const { lang, clinicId, role, section } = await params;
  if (section === "overview") notFound();
  return <PreviewClinicFrame lang={lang} clinicId={clinicId} role={role} section={section} />;
}
