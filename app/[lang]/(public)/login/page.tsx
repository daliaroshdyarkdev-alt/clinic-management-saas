import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/auth/redirect";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";

import { LoginForm } from "./login-form";

export async function generateMetadata({ params }: PageProps<"/[lang]/login">): Promise<Metadata> {
  const { lang } = await params;
  return { title: getDictionary(isLocale(lang) ? lang : "ar").auth.loginTitle };
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[lang]/login">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = getDictionary(lang);

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{dict.auth.loginTitle}</CardTitle>
          <CardDescription>{dict.auth.loginSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">{dict.common.loading}</p>}>
            <LoginFormWithParams locale={lang} dict={dict} searchParams={searchParams} />
          </Suspense>
          <p className="mt-4 text-xs text-muted-foreground">{dict.auth.identifierNotice}</p>
        </CardContent>
        <CardFooter className="justify-center gap-1 text-sm">
          <span className="text-muted-foreground">{dict.auth.noAccount}</span>
          <Link href={`/${lang}/register`} className="font-medium text-primary hover:underline">
            {dict.auth.registerLink}
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

async function LoginFormWithParams({
  locale,
  dict,
  searchParams,
}: {
  locale: Locale;
  dict: Dictionary;
  searchParams: PageProps<"/[lang]/login">["searchParams"];
}) {
  const query = await searchParams;
  const next = safeNextPath(query.next, locale);
  return (
    <LoginForm
      locale={locale}
      next={next}
      initialError={query.reason === "auth_unavailable" ? { error: "auth_unavailable" } : null}
      labels={{
        email: dict.auth.email,
        password: dict.auth.password,
        submit: dict.auth.submit,
        errors: {
          auth_unavailable: dict.auth.authUnavailable,
          invalid_input: dict.auth.invalidInput,
          invalid_credentials: dict.auth.invalidCredentials,
        },
      }}
    />
  );
}
