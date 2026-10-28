import { expect, test } from "@playwright/test";

test.describe("Arabic-speaking browser", () => {
  test.use({ locale: "ar-EG" });

  test("root redirects to the Arabic locale", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/ar$/);
  });
});

test("root falls back to Arabic when the browser states no preference", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0, headers: { "accept-language": "" } });
  expect(response.headers()["location"]).toMatch(/\/ar$/);
});

test("Arabic pages render right-to-left", async ({ page }) => {
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("لعيادتك");
  await expect(page.getByRole("note")).toContainText("بيانات تجريبية");
});

test("English pages render left-to-right", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("for your clinic");
});

test("language switch keeps the current page", async ({ page }) => {
  await page.goto("/ar/login");
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("signed-out visitors are redirected from the app to login", async ({ page }) => {
  await page.goto("/ar/app");
  await expect(page).toHaveURL(/\/ar\/login\?next=%2Far%2Fapp$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تسجيل الدخول");
});

test("login validates input on the server", async ({ page }) => {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Enter a valid email and password.");
});

test("security headers are set", async ({ request }) => {
  const response = await request.get("/en");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
});

test("layout has no horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/ar/login");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
