import { notFound } from "next/navigation";

import { AdminConsole } from "../console";

export default async function AdminSectionPage({ params }: PageProps<"/[lang]/admin/[section]">) {
  const { lang, section } = await params;
  if (section === "overview") notFound();
  return <AdminConsole lang={lang} section={section} />;
}
