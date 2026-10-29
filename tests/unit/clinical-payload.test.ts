import { describe, expect, it } from "vitest";
import { payloadFromForm, type TemplateField } from "@/modules/clinical/types";

const fields: TemplateField[] = [
  { key: "complaint", label: "Complaint", type: "textarea" },
  { key: "temp", label: "Temperature", type: "number" },
  { key: "smoker", label: "Smoker", type: "checkbox" },
  { key: "note", label: "Note", type: "text" },
];

describe("payloadFromForm", () => {
  it("types values and drops empty inputs and unknown keys", () => {
    const form = new FormData();
    form.set("field_complaint", "  Synthetic cough ");
    form.set("field_temp", "37.5");
    form.set("field_note", "   ");
    form.set("field_injected", "x");
    expect(payloadFromForm(fields, form)).toEqual({ complaint: "Synthetic cough", temp: 37.5, smoker: false });
  });
});
