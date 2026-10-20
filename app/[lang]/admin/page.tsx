import { AdminConsole } from "./console";

export default async function AdminOverviewPage({ params }: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  return <AdminConsole lang={lang} section="overview" />;
}
