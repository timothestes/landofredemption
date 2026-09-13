import { test, expect, type Page, type Locator } from "@playwright/test";
import { admin, adminAvailable } from "../seed";
import { deleteTestUser } from "../deleteUser";

// Full poster journey against the dev server: grant → write → upload → publish
// → public page → feed → unpublish → 404 → delete. Runs in both Playwright
// projects; the mobile one also proves the Write/Preview toggle and the
// Articles link in the hamburger menu.

const PASSWORD = "Testpass12345";
// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// The dev server compiles each route the first time it's hit and broadcasts a
// Fast Refresh "full reload" to whatever page is currently on screen; if that
// lands mid-navigation, Playwright sees our goto racing it and throws
// "interrupted by another navigation". Doesn't happen in production (no HMR)
// and doesn't happen once the route is warm, so a single retry clears it.
async function gotoStable(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (e) {
    if (e instanceof Error && /interrupted by another navigation/.test(e.message)) {
      await page.goto(url);
    } else {
      throw e;
    }
  }
}

// AdminProvider's isAdmin check (components/providers/AdminProvider.tsx) used
// to transiently miss on the very first page load right after sign-in — it
// only re-checked on mount or the next auth-state-change event, and neither
// fires after the server-action sign-in's redirect. Fixed by re-deriving on
// every route change instead (see AdminProvider.tsx); this retry loop is now
// just a defensive fallback for the same class of local-dev fetch blip
// utils/supabase/getUserSafe.ts documents and tolerates elsewhere.
// The caller is expected to have already opened the mobile menu once (for
// the Articles-link check); a reload always closes it again, so it's
// reopened only on the retry path, never on the fast (already-open) path.
async function openAdminMenu(page: Page, isMobile: boolean): Promise<Locator> {
  const adminToggle = page.getByRole("button", { name: "Admin", exact: true }).and(page.locator(":visible"));
  for (let attempt = 0; ; attempt++) {
    try {
      await expect(adminToggle).toBeVisible({ timeout: attempt === 0 ? 5_000 : 10_000 });
      return adminToggle;
    } catch (e) {
      if (attempt >= 2) throw e;
      await page.reload();
      await page.waitForLoadState("load");
      if (isMobile) await page.locator("nav").locator('button[class*="lg:hidden"]').first().click();
    }
  }
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15_000 });
  for (let i = 0; i < 40; i++) {
    const before = page.url();
    await page.waitForTimeout(250);
    if (page.url() === before) break;
  }
  await page.waitForLoadState("load");
}

test.describe("articles: poster publish flow", () => {
  test.skip(!adminAvailable, "needs SUPABASE_SERVICE_ROLE_KEY");
  let userId = "";
  let email = "";

  test.beforeEach(async () => {
    email = `poster-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userId = data.user.id;
    const { error: permErr } = await admin!.from("admin_users").insert({ user_id: userId, permissions: ["publish_posts"] });
    if (permErr) throw new Error(`grant: ${permErr.message}`);
  });

  test.afterEach(async () => {
    if (!userId) return;
    await admin!.from("admin_users").delete().eq("user_id", userId);
    const gone = await deleteTestUser(admin!, userId);
    expect(gone, "poster user leaked").toBe(true);
  });

  test("write, upload, publish, read, feed, unpublish, delete", async ({ page, isMobile }) => {
    await signIn(page, email);

    // The Articles link exists in whichever nav this viewport renders. The
    // hamburger button carries no accessible name (icon-only, no aria-label),
    // so it is targeted by its distinguishing Tailwind class instead of a role.
    if (isMobile) await page.locator("nav").locator('button[class*="lg:hidden"]').first().click();
    await expect(page.getByRole("link", { name: "Articles" }).first()).toBeVisible();

    // "Articles" above is the public nav link — visible to everyone signed
    // out, so it never exercises the publish_posts grant. Walk the actual
    // gated entry point: the Admin dropdown's "Posts" link only renders once
    // the signed-in user holds publish_posts. Desktop and mobile share one
    // isAdminOpen toggle, so both dropdown panels mount into the DOM the
    // moment it flips regardless of viewport — ":visible" picks out whichever
    // one this viewport actually shows.
    const adminToggle = await openAdminMenu(page, isMobile);
    await adminToggle.click();
    const postsLink = page.getByRole("link", { name: "Posts", exact: true }).and(page.locator(":visible"));
    await expect(postsLink).toBeVisible();
    await postsLink.click();
    await expect(page).toHaveURL(/\/admin\/posts$/);
    await expect(page.getByRole("heading", { level: 1, name: "Posts", exact: true })).toBeVisible();

    await gotoStable(page, "/admin/posts/new");
    // Date.now() alone can collide between the two Playwright projects
    // running concurrently against the same dev server, and the app's own
    // slug-collision check only looks at posts the caller can see (RLS hides
    // other posters' drafts) — so two workers picking the same millisecond
    // would both try to insert the same globally-unique slug. The random
    // suffix (same idea as the emails above) keeps each run's slug unique.
    const suffix = Math.random().toString(36).slice(2, 8);
    const title = `E2E article ${Date.now()}-${suffix}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Body").fill("# Heading\n\nHello **world**.\n\nhttps://youtu.be/dQw4w9WgXcQ");

    // Image upload through the toolbar's hidden input.
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Upload image" }).click(),
    ]);
    await chooser.setFiles({ name: "pixel.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByLabel("Body")).toHaveValue(/!\[pixel\]\(https:\/\/.*blob\.vercel-storage\.com\/posts\//, {
      timeout: 30_000,
    });
    // The first upload created the draft and rewrote the URL in place.
    await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/);

    if (isMobile) {
      await page.getByRole("tab", { name: "Preview" }).click();
      await expect(page.locator(".article-body iframe")).toHaveCount(1);
      await page.getByRole("tab", { name: "Write" }).click();
    }

    // Playwright's `name` is a case-insensitive substring match by default,
    // and "Publish" is literally a substring of "Unpublish" — every
    // Publish/Unpublish button lookup below is `exact: true` so a lookup for
    // one can never accidentally match the other's button.
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    // The "Published" toast is a decorative, self-dismissing (~3.2s) client
    // notification, and the dev server's first-ever compile of a Server
    // Action mid-test can force a Fast Refresh full reload of the open admin
    // page (same class of race as gotoStable above) that wipes the toast's
    // React state before it paints — confirmed by hand: the post reliably
    // flips to published in the DB regardless. The Publish button turning
    // into "Unpublish" is the durable, equally-specific signal that the same
    // publish actually succeeded, so assert on that instead of the toast.
    await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible({ timeout: 30_000 });
    const editUrl = page.url();
    const slug = await page.getByLabel("Slug").inputValue();
    expect(slug).toMatch(/^e2e-article-\d+-[a-z0-9]+$/);

    // Public page: title, byline, image, embed. next/cache's unstable_cache
    // implements stale-while-revalidate on revalidateTag: the first read after
    // a write can still return the old (cached) value while it refreshes in
    // the background, so poll until the fresh copy is live rather than
    // asserting on the very next request.
    await expect
      .poll(async () => (await page.request.get(`/articles/${slug}`)).status(), { timeout: 15_000, intervals: [500] })
      .toBe(200);
    await gotoStable(page, `/articles/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator(".article-body img")).toHaveCount(1);
    await expect(page.locator(".article-body iframe[src*='youtube-nocookie.com/embed/dQw4w9WgXcQ']")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toBeVisible();

    // Feed lists it — same stale-while-revalidate window as above, so poll.
    await expect
      .poll(async () => (await page.request.get("/articles/feed.xml")).text(), { timeout: 15_000, intervals: [500] })
      .toContain(`/articles/${slug}</link>`);
    const feed = await page.request.get("/articles/feed.xml");
    expect(feed.headers()["content-type"]).toContain("application/rss+xml");

    // Unpublish → public 404.
    await gotoStable(page, editUrl);
    await page.getByRole("button", { name: "Unpublish", exact: true }).click();
    // Same rationale as the Publish step above: assert the durable button
    // flip rather than the transient "Unpublished" toast. Exact match — see
    // the note above the first Publish click.
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await page.request.get(`/articles/${slug}`)).status(), { timeout: 15_000, intervals: [500] })
      .toBe(404);

    // Delete (cleans the Blob prefix server-side).
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(page).toHaveURL(/\/admin\/posts$/);
    await expect(page.getByText(title)).toHaveCount(0);
  });
});
