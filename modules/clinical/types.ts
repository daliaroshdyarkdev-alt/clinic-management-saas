import { z } from "zod";

export const templateFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "textarea", "number", "date", "select", "checkbox"]),
  options: z.array(z.string().min(1).max(100)).max(50).optional(),
  required: z.boolean().optional(),
});

export type TemplateField = z.infer<typeof templateFieldSchema>;

export const consultationSchema = z.object({
  id: z.uuid(),
  appointment_id: z.uuid(),
  status: z.enum(["draft", "completed"]),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  fields: z.array(templateFieldSchema),
  values: z.record(z.string(), z.unknown()),
  archived: z.array(z.object({ key: z.string(), label: z.string(), value: z.unknown() })),
  corrections: z.array(z.object({ body: z.string(), created_at: z.string() })),
  patient: z.object({
    chart_number: z.number(),
    full_name: z.string(),
    date_of_birth: z.string(),
    gender: z.enum(["male", "female"]),
  }),
});

export type Consultation = z.infer<typeof consultationSchema>;

/**
 * Converts submitted form values into a typed payload for the template.
 * Empty inputs are omitted; numbers and checkboxes get their JSON types.
 */
export function payloadFromForm(
  fields: TemplateField[],
  formData: FormData,
): Record<string, string | number | boolean> {
  const payload: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const raw = formData.get(`field_${field.key}`);
    if (field.type === "checkbox") {
      payload[field.key] = raw === "on";
      continue;
    }
    if (typeof raw !== "string" || raw.trim() === "") continue;
    if (field.type === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) payload[field.key] = n;
    } else {
      payload[field.key] = raw.trim().slice(0, 10_000);
    }
  }
  return payload;
}
