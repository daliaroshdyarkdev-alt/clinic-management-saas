import { notFound } from "next/navigation";

import { adminSections } from "@/modules/permissions/navigation";

import { PreviewAdminFrame } from "../../frames";

export function generateStaticParams() {
  return adminSections.filter((section) => section !== "overview").map((section) => ({ section }));
}

export default async function PreviewAdminSectionPage({ params }: PageProps<"/[lang]/preview/admin/[section]">) {
  const { lang, section } = await params;
  if (section === "overview") notFound();
  return <PreviewAdminFrame lang={lang} section={section} />;
}
