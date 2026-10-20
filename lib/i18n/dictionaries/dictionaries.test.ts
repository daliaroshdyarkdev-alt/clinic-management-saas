import { describe, expect, it } from "vitest";

import { ar } from "./ar";
import { en } from "./en";
import { interpolate } from "./index";

function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return [`${path}[${value.length}]`, ...value.flatMap((v, i) => shape(v, `${path}[${i}]`))];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => shape(inner, path ? `${path}.${key}` : key));
  }
  return [path];
}

function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [];
}

describe("dictionaries", () => {
  it("English has exactly the Arabic keys (including array lengths)", () => {
    expect(shape(en).sort()).toEqual(shape(ar).sort());
  });

  it("has no empty strings", () => {
    for (const text of [...leaves(ar), ...leaves(en)]) expect(text.trim()).not.toBe("");
  });

  it("uses the same placeholders in both languages", () => {
    const placeholders = (dict: unknown) => leaves(dict).map((text) => (text.match(/\{\w+\}/g) ?? []).sort().join(","));
    expect(placeholders(en)).toEqual(placeholders(ar));
  });

  it("Arabic strings contain Arabic script", () => {
    const arabic = /[؀-ۿ]/;
    const exceptions = new Set([ar.common.otherLanguage]);
    for (const text of leaves(ar)) if (!exceptions.has(text)) expect(text).toMatch(arabic);
  });
});

describe("interpolate", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(interpolate("{n} of {m}", { n: 3 })).toBe("3 of {m}");
  });
});
