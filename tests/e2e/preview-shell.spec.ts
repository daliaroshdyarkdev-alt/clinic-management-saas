import { expect, test, type Page } from "@playwright/test";

const ELITE = "0b9c6f2e-1d3a-4c5b-8e7f-a1b2c3d4e5f6";
const DENTAL = "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c";
const ONBOARDING = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

async function navKeys(page: Page): Promise<string[]> {
  const isMobile = (page.viewportSize()?.width ?? 1280) < 1024;
  if (isMobile) await page.getByTestId("mobile-nav-trigger").filter({ visible: true }).click();
  const scope = isMobile ? page.getByRole("dialog") : page.locator("aside");
  // Next.js keeps previously visited routes in the DOM but hidden (React Activity),
  // so only visible links count.
  return scope
    .locator("[data-nav-key]")
    .filter({ visible: true })
    .evaluateAll((links) => links.map((l) => l.getAttribute("data-nav-key") ?? ""));
}

test.describe("preview shell with synthetic data (ADR-0005)", () => {
  test("labels every preview page as synthetic", async ({ page }) => {
    await page.goto(`/en/preview/c/${ELITE}/owner`);
    await expect(page.getByTestId("preview-banner")).toContainText("synthetic");
  });

  test("role-aware navigation: owner sees finance but not consultations", async ({ page }) => {
    await page.goto(`/en/preview/c/${ELITE}/owner`);
    const keys = await navKeys(page);
    expect(keys).toContain("finance");
    expect(keys).toContain("staff");
    expect(keys).not.toContain("consultations");
  });

  test("role-aware navigation: doctor sees consultations but not finance", async ({ page }) => {
    await page.goto(`/en/preview/c/${ELITE}/doctor`);
    const keys = await navKeys(page);
    expect(keys).toContain("consultations");
    expect(keys).not.toContain("finance");
    expect(keys).not.toContain("staff");
  });

  test("receptionist dashboard has no finance widget", async ({ page }) => {
    await page.goto(`/en/preview/c/${ELITE}/receptionist`);
    await expect(page.getByTestId("stat-appointments")).toBeVisible();
    await expect(page.getByTestId("stat-collections")).toHaveCount(0);
  });

  test("hidden sections are not reachable by URL", async ({ page }) => {
    await page.goto(`/en/preview/c/${ELITE}/doctor/finance`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.goto(`/en/preview/c/${ELITE}/owner/consultations`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("clinic switcher navigates to the other clinic's URL (STA-004, ADR-0002)", async ({ page }) => {
    await page.goto(`/en/preview/c/${ELITE}/receptionist`);
    await page.getByTestId("clinic-switcher").click();
    await page.getByTestId("clinic-option").filter({ hasText: "Demo Dental Center" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/preview/c/${DENTAL}/receptionist$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demo Dental Center");
    // Full document load: nothing from the previous clinic remains in the DOM, even hidden.
    await expect(page.getByText("Demo Elite Clinic", { exact: true })).toHaveCount(0);
  });

  test("preview role switcher changes the navigation", async ({ page }) => {
    await page.goto(`/en/preview/c/${ELITE}/owner`);
    await page.getByTestId("role-switcher").click();
    await page.getByTestId("role-option-cashier").click();
    await expect(page).toHaveURL(new RegExp(`/en/preview/c/${ELITE}/cashier$`));
    expect(await navKeys(page)).toEqual(["overview", "cashier"]);
  });

  test("an onboarding clinic exposes only onboarding sections (ONB-004)", async ({ page }) => {
    await page.goto(`/en/preview/c/${ONBOARDING}/owner`);
    await expect(page.getByTestId("onboarding-status")).toBeVisible();
    expect(await navKeys(page)).toEqual(["overview", "settings"]);
  });

  test("Arabic preview is RTL with Arabic-Indic digits", async ({ page }) => {
    await page.goto(`/ar/preview/c/${ELITE}/owner`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("stat-appointments")).toContainText("٧");
  });

  test("platform admin preview states its access boundaries (ADM-003)", async ({ page }) => {
    await page.goto("/en/preview/admin");
    await expect(page.getByTestId("admin-restriction")).toContainText("cannot view clinic medical records");
    expect(await navKeys(page)).not.toContain("finance");
  });

  test("page does not scroll horizontally", async ({ page }) => {
    await page.goto(`/ar/preview/c/${ELITE}/owner`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
