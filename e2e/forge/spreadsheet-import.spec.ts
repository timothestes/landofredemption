import { test, expect, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { adminAvailable, seedForgeMember, cleanupForgeMember, type SeededForgeMember } from "./forgeSeed";

// Smallest valid JPEG (1×1 white) — renders with naturalWidth 1.
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const FIXTURE_CARDS = ["Sheet Hero Alpha", "Sheet Relic Beta"];

// Roots 2 convention: split Book/Chapter/Verse + Artist + Image columns.
const CSV = [
  "Name,#,Set,Type,Brigade,Strength,Toughness,Class,Identifier,Special Ability,Rarity,Book,Chapter,Verse,Alignment,Legality,Artist,Image",
  '"Sheet Hero Alpha",1,Test Set,Hero,Silver,9,9,Warrior,-,"Test ability alpha.",-,Genesis,1,1,Good,Rotation,E2E Artist,Sheet-Hero-Alpha',
  // Beta deliberately has NO image in the zip (exercises the imageless path)
  '"Sheet Relic Beta",2,Test Set,Artifact,-,-,-,-,-,"Test ability beta.",-,-,-,-,Neutral,Rotation,-,Sheet-Relic-Beta',
].join("\n");

function buildImagesZip(): Buffer {
  const jpeg = new Uint8Array(Buffer.from(TINY_JPEG_BASE64, "base64"));
  const zipped = zipSync({
    "Sheet-Hero-Alpha.jpg": jpeg,
    "__MACOSX/._Sheet-Hero-Alpha.jpg": new Uint8Array([0]), // macOS junk must be ignored
    "unrelated-extra.jpg": jpeg,                             // orphan image, matches no row
  }, { level: 0 });
  return Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength);
}

test.describe("forge spreadsheet set import", () => {
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
    try {
      await page.goto(path);
    } catch {
      await page.goto(path);
    }
  }

  async function uploadFixture(page: Page) {
    await gotoSettled(page, "/forge/import");
    await page.getByText("Card images + spreadsheet").click();
    await page.getByLabel("Choose spreadsheet…").setInputFiles({
      name: "test-cards.csv", mimeType: "text/csv", buffer: Buffer.from(CSV),
    });
    await expect(page.getByText(/2 cards/).first()).toBeVisible();
  }

  test("elder imports csv + images zip; cleaning stats, images, and idempotent re-run", async ({ page }) => {
    test.setTimeout(180_000);
    const seed = await seedForgeMember("elder");
    try {
      await signIn(page, seed);
      await uploadFixture(page);

      // Without a zip: clearly communicated text-only mode.
      await expect(page.getByText("no images zip — cards import as text only")).toBeVisible();

      await page.getByLabel("Choose images zip…").setInputFiles({
        name: "images.zip", mimeType: "application/zip", buffer: buildImagesZip(),
      });
      // 2 images counted (junk ignored), 1 card matched, 1 without, 1 orphan surfaced.
      await expect(page.getByText("2 images")).toBeVisible();
      await expect(page.getByText("1 without an image")).toBeVisible();
      await expect(page.getByText("1 zip images match no row")).toBeVisible();

      // destination: new set (name prefilled from the csv file name)
      const setName = `E2E Sheet Import ${Date.now()}`;
      await page.getByRole("button", { name: "Import 2 cards" }).click();
      await page.getByLabel("New set name").fill(setName);
      await page.getByRole("button", { name: "Create set & import 2 cards" }).click();
      await expect(page.getByText("Imported 2 · Skipped 0 · Failed 0")).toBeVisible({ timeout: 120_000 });

      // set grid shows both cards; the matched finished image renders via the authed proxy
      await page.getByRole("link", { name: "View set →" }).click();
      for (const name of FIXTURE_CARDS) {
        await expect(page.getByText(name).first()).toBeVisible();
      }
      const img = page.locator('img[src*="kind=finished"]').first();
      await expect(img).toBeVisible();
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 })
        .toBeGreaterThan(0);

      // idempotent re-run into the same set (no zip needed): nothing to do, and it says so
      await uploadFixture(page);
      await page.getByLabel("Add to an existing set").check();
      await page.getByLabel("Existing set", { exact: true }).selectOption({ label: setName });
      await expect(page.getByRole("button", { name: "Nothing new to import" })).toBeDisabled({ timeout: 30_000 });
      await expect(page.getByText("All 2 are already in this set.", { exact: false })).toBeVisible();
    } finally {
      await cleanupForgeMember(seed);
    }
  });
});
