import { test, expect, type Page } from "@playwright/test";
import { adminAvailable, seedForgeMember, cleanupForgeMember, type SeededForgeMember } from "./forgeSeed";
import { buildFixtureZip, FIXTURE_CARDS } from "./lackeyFixture";

test.describe("forge lackey set import", () => {
  test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL");

  async function signIn(page: Page, seed: SeededForgeMember) {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(seed.email);
    await page.getByLabel(/password/i).fill(seed.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15_000 });
    // Let the post-login redirect finish rendering before tests navigate away.
    await page.waitForLoadState("load");
  }

  // The post-login page can fire a late client-side navigation that interrupts
  // the first goto after sign-in (seen on chromium-mobile) — retry once.
  async function gotoSettled(page: Page, path: string) {
    try {
      await page.goto(path);
    } catch {
      await page.goto(path);
    }
  }

  async function uploadFixture(page: Page) {
    await gotoSettled(page, "/forge/import");
    await page.getByLabel("Choose zip…").setInputFiles({
      name: "Test Plugin V1.zip", mimeType: "application/zip", buffer: buildFixtureZip(),
    });
    await page.getByRole("checkbox", { name: /TST/ }).check();
    await expect(page.getByText("3 cards selected")).toBeVisible();
  }

  test("anonymous visitors get a 404", async ({ page }) => {
    const resp = await page.goto("/forge/import");
    expect(resp?.status()).toBe(404);
  });

  test("playtesters are redirected to /forge/play", async ({ page }) => {
    const seed = await seedForgeMember("playtester");
    try {
      await signIn(page, seed);
      await gotoSettled(page, "/forge/import");
      await page.waitForURL(/\/forge\/play/);
    } finally {
      await cleanupForgeMember(seed);
    }
  });

  test("elder imports a filtered set, images render, re-import skips", async ({ page }) => {
    test.setTimeout(180_000);
    const seed = await seedForgeMember("elder");
    try {
      await signIn(page, seed);
      await uploadFixture(page);

      // preview: 3 matched, 1 flagged without image
      await expect(page.getByText("1 without an image")).toBeVisible();

      // destination: new set (name is prefilled from the ticked set)
      const setName = `E2E Import ${Date.now()}`;
      await page.getByRole("button", { name: "Import 3 cards" }).click();
      await page.getByLabel("New set name").fill(setName);
      await page.getByRole("button", { name: "Create set & import 3 cards" }).click();

      await expect(page.getByText("Imported 3 · Skipped 0 · Failed 0")).toBeVisible({ timeout: 120_000 });

      // set grid shows all three cards; finished images render through the authed proxy
      await page.getByRole("link", { name: "View set →" }).click();
      for (const name of FIXTURE_CARDS) {
        await expect(page.getByText(name).first()).toBeVisible();
      }
      const img = page.locator('img[src*="kind=finished"]').first();
      await expect(img).toBeVisible();
      // Images are loading="lazy" and served via the authed blob proxy — wait for the load.
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 })
        .toBeGreaterThan(0);

      // idempotent re-run into the same (now-existing) set: nothing to do, and it says so
      await uploadFixture(page);
      await page.getByLabel("Add to an existing set").check();
      await page.getByLabel("Existing set", { exact: true }).selectOption({ label: setName });
      await expect(page.getByRole("button", { name: "Nothing new to import" })).toBeDisabled({ timeout: 30_000 });
      await expect(page.getByText("All 3 are already in this set.", { exact: false })).toBeVisible();

      // overwrite re-run into the same set: the two rows with images count as changes, the third matches
      await uploadFixture(page);
      await page.getByLabel("Add to an existing set").check();
      await page.getByLabel("Existing set", { exact: true }).selectOption({ label: setName });
      await page.getByLabel("Overwrite existing cards").check();
      await page.getByRole("button", { name: "Overwrite 2 cards" }).click();
      await page.getByRole("button", { name: "Overwrite 2 cards" }).last().click(); // the confirm dialog's
      await expect(page.getByText("Imported 0 · Updated 2 · Unchanged 1 · Failed 0")).toBeVisible({ timeout: 120_000 });
    } finally {
      await cleanupForgeMember(seed);
    }
  });
});
