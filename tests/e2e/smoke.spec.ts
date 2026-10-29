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

test("platform admin area requires sign-in", async ({ page }) => {
  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fadmin$/);
});

test("registration page is bilingual and validates the password policy on the server", async ({ page }) => {
  await page.goto("/ar/register");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.goto("/en/register");
  await page.getByLabel("Full name").fill("Synthetic Person");
  await page.getByLabel("Email").fill("synthetic.person@example.test");
  await page.getByLabel("Password").fill("alllowercase1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Use at least 10 characters with upper- and lower-case letters and a digit.",
  );
});

test("invitation link asks signed-out visitors to sign in, keeping the link", async ({ page }) => {
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
  await page.goto(`/en/invite/${token}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clinic invitation");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/login\\?next=%2Fen%2Finvite%2F${token}$`));
});

test("licence files are not reachable without a session", async ({ request }) => {
  const response = await request.get("/api/licenses/00000000-0000-4000-8000-000000000000", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
});

test("public booking page degrades safely when the clinic is unavailable", async ({ page }) => {
  await page.goto("/en/book/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Request an appointment");
  await expect(page.getByText("This clinic is not taking online requests right now.")).toBeVisible();
});

test("an invalid offer link reveals nothing", async ({ page }) => {
  await page.goto("/ar/offer/not-a-real-token");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("هذا الرابط غير صالح.")).toBeVisible();
});

test("front-desk pages require sign-in", async ({ page }) => {
  for (const path of ["queue", "appointments", "requests", "patients", "doctors", "my-queue"]) {
    await page.goto(`/en/app/${path}`);
    await expect(page).toHaveURL(new RegExp(`/en/login\\?next=%2Fen%2Fapp%2F${path}$`));
  }
});

test("WhatsApp webhook rejects unsigned callbacks and wrong verify tokens", async ({ request }) => {
  const post = await request.post("/api/webhooks/whatsapp", {
    data: { entry: [] },
    headers: { "x-hub-signature-256": "sha256=00" },
  });
  expect(post.status()).toBe(401);
  const get = await request.get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1");
  expect(get.status()).toBe(403);
});

test("WhatsApp settings require sign-in", async ({ page }) => {
  await page.goto("/en/app/whatsapp");
  await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fapp%2Fwhatsapp$/);
});
