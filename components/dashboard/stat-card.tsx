import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  testId?: string;
}) {
  return (
    <Card className="gap-0 py-5" data-testid={testId}>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}
