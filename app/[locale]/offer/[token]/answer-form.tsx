"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, FormSuccess } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { answerOffer, type PublicState } from "@/modules/public-booking/actions";

export function AnswerForm({ token }: { token: string }) {
  const t = useTranslations("offer");
  const [state, action] = useActionState<PublicState, FormData>(answerOffer, { error: null });

  if (state.outcome && state.outcome !== "submitted") return <FormSuccess>{t(`outcome.${state.outcome}`)}</FormSuccess>;

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="accept" value="true">
          {t("accept")}
        </SubmitButton>
        <SubmitButton name="accept" value="false" variant="outline">
          {t("decline")}
        </SubmitButton>
      </div>
      <FormError code={state.error} />
    </form>
  );
}
