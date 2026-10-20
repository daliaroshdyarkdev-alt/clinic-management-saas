import { describe, expect, it } from "vitest";

import { directionOf, negotiateLocale, switchLocalePath } from "./config";

describe("negotiateLocale", () => {
  it("defaults to Arabic (Arabic-first product)", () => {
    expect(negotiateLocale(null)).toBe("ar");
    expect(negotiateLocale("fr-FR,de;q=0.8")).toBe("ar");
  });

  it("prefers a valid locale cookie", () => {
    expect(negotiateLocale("ar-EG", "en")).toBe("en");
    expect(negotiateLocale("en-US", "xx")).toBe("en");
  });

  it("honours Accept-Language q-values", () => {
    expect(negotiateLocale("en-US,en;q=0.9,ar;q=0.8")).toBe("en");
    expect(negotiateLocale("en;q=0.5,ar-EG;q=0.9")).toBe("ar");
    expect(negotiateLocale("en;q=0")).toBe("ar");
  });
});

describe("directionOf", () => {
  it("maps Arabic to RTL and English to LTR", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });
});

describe("switchLocalePath", () => {
  it("swaps the locale prefix and keeps the rest of the path", () => {
    expect(switchLocalePath("/ar/c/abc/queue", "en")).toBe("/en/c/abc/queue");
    expect(switchLocalePath("/en", "ar")).toBe("/ar");
    expect(switchLocalePath("/", "en")).toBe("/en");
  });
});
