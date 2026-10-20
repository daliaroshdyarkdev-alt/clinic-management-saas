import { FlaskConical } from "lucide-react";

export function PreviewBanner({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-warning/25 px-4 py-1.5 text-center text-xs font-medium text-warning-foreground"
      data-testid="preview-banner"
    >
      <FlaskConical className="size-3.5" aria-hidden />
      {text}
    </div>
  );
}
