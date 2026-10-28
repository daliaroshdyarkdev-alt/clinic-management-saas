import { getFormatter, getTranslations } from "next-intl/server";
import { enterRouteLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";
import { listClinics } from "@/modules/platform-admin/queries";

const STATES = ["pending", "active", "suspended", "closed"] as const;

export default async function AdminClinicsPage({ params, searchParams }: PageProps<"/[locale]/admin">) {
  const locale = enterRouteLocale((await params).locale);
  await requirePlatformAdmin(locale);
  const { state } = await searchParams;
  const filter = STATES.find((s) => s === state) ?? "pending";
  const t = await getTranslations("admin");
  const to = await getTranslations("overview.states");
  const format = await getFormatter();
  const clinics = (await listClinics()).filter((c) => c.account_state === filter);

  return (
    <div className="grid max-w-4xl gap-4">
      <h1 className="text-2xl font-semibold">{t("clinicsTitle")}</h1>
      <nav aria-label={t("filter")} className="flex flex-wrap gap-2">
        {STATES.map((s) => (
          <Link
            key={s}
            href={{ pathname: "/admin", query: { state: s } }}
            aria-current={s === filter ? "page" : undefined}
            className="rounded-md border px-3 py-1 text-sm aria-[current=page]:bg-accent aria-[current=page]:font-medium"
          >
            {to(s)}
          </Link>
        ))}
      </nav>
      {clinics.length === 0 ? (
        <p className="text-muted-foreground">{t("noClinics")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {clinics.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <Link
                href={`/admin/clinics/${c.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {c.name}
              </Link>
              <span className="text-muted-foreground">
                {t("registeredAt", { date: format.dateTime(new Date(c.created_at), { dateStyle: "medium" }) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
