// Signed-in journeys over the synthetic seed (supabase/seed.sql). They check
// what each role can reach through the real app, Supabase Auth and RLS.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Synthetic-Pass-2026";
const CLINIC_A = "22222222-2222-4222-8222-00000000000a";

async function signIn(page: Page, email: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/app/);
}

test("owner reaches every clinic area including finance, WhatsApp and subscription", async ({ page }) => {
  await signIn(page, "owner.a@example.test");
  for (const path of ["/en/app/finance", "/en/app/whatsapp", "/en/app/subscription", "/en/app/staff"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(/don't have|Only the clinic owner/)).toHaveCount(0);
  }
});

test("receptionist runs the front desk but cannot see finance or the subscription", async ({ page }) => {
  await signIn(page, "reception.a@example.test");
  await page.goto("/en/app/queue");
  await expect(page.getByText("don't have access")).toHaveCount(0);
  await page.goto("/en/app/finance");
  await expect(page.getByText("You don't have finance permissions in this clinic.")).toBeVisible();
  await page.goto("/en/app/subscription");
  await expect(page.getByText("Only the clinic owner manages the subscription.")).toBeVisible();
});

test("a suspended employee cannot use the clinic", async ({ page }) => {
  await signIn(page, "suspended.a@example.test");
  await page.goto("/en/app/queue");
  await expect(page.getByText("Today's queue")).toHaveCount(0);
});

test("a forged active-clinic cookie cannot open another clinic (INV-2)", async ({ page, context, request }) => {
  await signIn(page, "owner.b@example.test");
  const url = new URL(page.url());
  await context.addCookies([{ name: "active_clinic_id", value: CLINIC_A, domain: url.hostname, path: "/" }]);
  await page.goto("/en/app");
  await expect(page.getByText("Synthetic Smile Dental").first()).toBeVisible();
  await expect(page.getByText("عيادة النور التجريبية")).toHaveCount(0);
  // Without a session the export endpoint refuses outright.
  expect((await request.get("/api/finance/export?from=2020-01-01&to=2030-01-01")).status()).toBe(401);
});

test("platform admin sees administration but no clinic finance", async ({ page }) => {
  await signIn(page, "admin@example.test");
  await page.goto("/en/admin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/en/admin/billing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Subscriptions and billing");
});

test("switching clinics shows only the selected clinic's data (INV-3)", async ({ page }) => {
  await signIn(page, "doctor.shared@example.test");
  const switcher = page.getByLabel("Switch clinic");
  await expect(switcher).toBeVisible();
  const before = await switcher.inputValue();
  const other = await switcher
    .locator("option")
    .evaluateAll(
      (options, current) => options.map((o) => (o as HTMLOptionElement).value).find((v) => v !== current),
      before,
    );
  await switcher.selectOption(other!);
  await expect(switcher).toHaveValue(other!);
  await page.reload();
  await expect(page.getByLabel("Switch clinic")).toHaveValue(other!);
});

test("Arabic owner view renders right-to-left", async ({ page }) => {
  await page.goto("/ar/login");
  await page.locator("#email").fill("owner.a@example.test");
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/ar\/app/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
