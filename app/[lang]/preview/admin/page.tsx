import { PreviewAdminFrame } from "../frames";

export default async function PreviewAdminPage({ params }: PageProps<"/[lang]/preview/admin">) {
  const { lang } = await params;
  return <PreviewAdminFrame lang={lang} section="overview" />;
}
