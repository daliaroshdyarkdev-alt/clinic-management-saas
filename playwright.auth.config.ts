import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

// Authenticated journeys against a real local Supabase stack with the
// synthetic seed (`supabase start && supabase db reset`). CI exports the
// local URL and keys from `supabase status -o env`.
export default defineConfig({
  testDir: "tests/e2e-auth",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/ar`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "",
      SITE_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
