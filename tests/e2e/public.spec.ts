import { expect, test } from "@playwright/test";

test.describe("locale routing and direction (ADR-0003)", () => {
  test("redirects / to Arabic when no supported language is preferred", async ({ request }) => {
    const response = await request.get("/", { headers: { "Accept-Language": "fr-FR" }, maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers()["location"] ?? "", "http://x").pathname).toBe("/ar");
  });

  test("Arabic pages render RTL", async ({ page }) => {
    await page.goto("/ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });

  test("honours an English Accept-Language and renders LTR", async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("language switcher keeps the current page", async ({ page }) => {
    await page.goto("/en/register");
    await page.getByTestId("locale-switcher").first().click();
    await expect(page).toHaveURL(/\/ar\/register$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("shows the legal disclaimer placeholder (ONB-007)", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByTestId("legal-disclaimer")).toContainText("pending legal review");
  });

  test("unknown pages render the localized 404", async ({ page }) => {
    const response = await page.goto("/en/definitely-not-a-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("sends security headers", async ({ request }) => {
    const response = await request.get("/en");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });
});

test.describe("protected routes (invariant 2)", () => {
  for (const path of ["/en/workspaces", "/en/admin", "/en/c/11111111-1111-4111-8111-111111111111/finance"]) {
    test(`redirects signed-out users from ${path} to login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/login\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get("next")).toBe(path);
      await expect(page.getByTestId("login-error")).toBeVisible();
    });
  }

  test("login refuses to redirect off-site", async ({ page }) => {
    await page.goto("/en/login?next=//evil.example");
    await expect(page.locator('input[name="next"]')).toHaveValue("/en/workspaces");
  });

  test("login reports that auth is not configured instead of failing silently", async ({ page }) => {
    await page.goto("/en/login");
    await page.getByLabel("Email").fill("someone@example.test");
    await page.getByLabel("Password").fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("login-error")).toContainText("not configured");
  });

  test("sign-out answers with 303 to the localized login page", async ({ request, baseURL }) => {
    const response = await request.post("/api/auth/sign-out", {
      form: { locale: "ar" },
      headers: { Origin: baseURL ?? "" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(new URL(response.headers()["location"] ?? "", "http://x").pathname).toBe("/ar/login");
  });

  test("sign-out rejects cross-site requests", async ({ request }) => {
    const response = await request.post("/api/auth/sign-out", {
      form: { locale: "en" },
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
  });
});
