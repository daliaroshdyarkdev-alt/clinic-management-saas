import type { Dictionary } from "@/lib/i18n/dictionaries";

/** ONB-007: legal disclaimer. The text is a placeholder until legal review (OD-22). */
export function Disclaimer({ dict }: { dict: Dictionary }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground" data-testid="legal-disclaimer">
      <span className="font-medium">{dict.disclaimer.title}: </span>
      {dict.disclaimer.body} <span className="italic">({dict.disclaimer.pendingReview})</span>
    </p>
  );
}
