import { test, expect, type Page } from "@playwright/test";
import { adminAvailable, seedForgeMember, cleanupForgeMember, type SeededForgeMember } from "./forgeSeed";
import { buildFixtureZip } from "./lackeyFixture";

test.describe("forge uiux pass", () => {
  test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL");

  async function signIn(page: Page, seed: SeededForgeMember) {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(seed.email);
    await page.getByLabel(/password/i).fill(seed.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15_000 });
    await page.waitForLoadState("load");
  }

  async function gotoSettled(page: Page, path: string) {
    try { await page.goto(path); } catch { await page.goto(path); }
  }

  test("nav has no Desk tab; landing shows dashboard", async ({ page }) => {
    const seed = await seedForgeMember("elder");
    try {
      await signIn(page, seed);
      await gotoSettled(page, "/forge");
      await expect(page.getByRole("link", { name: "Ideas", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Desk" })).toHaveCount(0);
      await expect(page.getByText("Your sets")).toBeVisible();
    } finally {
      await cleanupForgeMember(seed);
    }
  });

  test("import → bulk release → badges flip → re-run skips", async ({ page }) => {
    test.setTimeout(180_000);
    const seed = await seedForgeMember("elder");
    try {
      await signIn(page, seed);
      // Import the 3-card TST fixture into a fresh set.
      await gotoSettled(page, "/forge/import");
      await page.getByLabel("Lackey zip file").setInputFiles({
        name: "Test Plugin V1.zip", mimeType: "application/zip", buffer: buildFixtureZip(),
      });
      await page.getByRole("checkbox", { name: /TST/ }).check();
      await expect(page.getByText("3 cards selected")).toBeVisible();
      const setName = `E2E UIUX ${Date.now()}`;
      await page.getByRole("button", { name: "Import 3 cards" }).click();
      await page.getByLabel("New set name").fill(setName);
      await page.getByRole("button", { name: "Create set & import 3 cards" }).click();
      await expect(page.getByText("Imported 3 · Skipped 0 · Failed 0")).toBeVisible({ timeout: 120_000 });
      await page.getByRole("link", { name: "View set →" }).click();

      // Breadcrumb present on the set cards page.
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Sets");

      // Bulk release all three drafts.
      await page.getByRole("button", { name: "Select" }).click();
      await page.getByRole("button", { name: /^Select all/ }).click();
      await page.getByRole("button", { name: /^Release to playtest/ }).click();
      await expect(page.getByText("Released 3 · 0 skipped · 0 failed")).toBeVisible({ timeout: 60_000 });
      // Match the grid status badge, not the (hidden) "In playtest" <option> in the status filter.
      await expect(page.locator("span.rounded-full", { hasText: "In playtest" }).first()).toBeVisible();

      // Mark final all three, then re-run: everything skips (eligibility filter).
      await page.getByRole("button", { name: /^Select all/ }).click();
      await page.getByRole("button", { name: /^Mark final/ }).click();
      await expect(page.getByText("Marked final 3 · 0 skipped · 0 failed")).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: /^Select all/ }).click();
      // All cards are now Final — Mark final has 0 eligible and must be disabled.
      await expect(page.getByRole("button", { name: /^Mark final/ })).toBeDisabled();
    } finally {
      await cleanupForgeMember(seed);
    }
  });
});
