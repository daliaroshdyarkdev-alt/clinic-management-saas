import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PUBLIC_PAGES = [
  "/ar",
  "/en",
  "/ar/login",
  "/en/login",
  "/en/register",
  "/ar/book/00000000-0000-4000-8000-000000000000",
  "/en/offer/not-a-real-token",
];

test("pages send a nonce-based CSP and every script carries the nonce", async ({ page }) => {
  const response = await page.goto("/en/login");
  const csp = response?.headers()["content-security-policy"] ?? "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  const scripts = await page.locator("script").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
  expect(scripts.length).toBeGreaterThan(0);
  for (const n of scripts) expect(n).toBe(nonce);
});

test("each request gets a fresh nonce", async ({ request }) => {
  const a = (await request.get("/ar")).headers()["content-security-policy"];
  const b = (await request.get("/ar")).headers()["content-security-policy"];
  expect(a).not.toBe(b);
});

test("unknown pages show a localized not-found page", async ({ page }) => {
  const response = await page.goto("/en/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});

for (const path of PUBLIC_PAGES) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
