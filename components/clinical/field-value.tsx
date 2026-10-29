import type { TemplateField } from "@/modules/clinical/types";

/** Read-only rendering of one recorded value. */
export function FieldValue({
  field,
  value,
  yes,
  no,
}: {
  field?: TemplateField;
  value: unknown;
  yes: string;
  no: string;
}) {
  if (value === undefined || value === null || value === "") return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean" || field?.type === "checkbox") return <span>{value ? yes : no}</span>;
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}
