import { Construction } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/dictionaries";

/** Shown for modules scheduled in later milestones, with their requirement IDs for traceability. */
export function SectionPlaceholder({
  dict,
  title,
  milestone,
  requirements,
}: {
  dict: Dictionary;
  title: string;
  milestone: number;
  requirements: readonly string[];
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Construction className="size-5" aria-hidden />
            </span>
            <div>
              <CardTitle>{dict.section.title}</CardTitle>
              <CardDescription>{interpolate(dict.common.plannedMilestone, { n: milestone })}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{dict.section.body}</p>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{dict.common.requirements}</p>
            <div className="flex flex-wrap gap-1.5" dir="ltr">
              {requirements.map((id) => (
                <Badge key={id} variant="outline" className="font-mono">
                  {id}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
