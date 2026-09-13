import { test, expect, type Page } from "@playwright/test";
import { admin, adminAvailable } from "./seed";
import { deleteTestUser } from "./deleteUser";

// Regression test for the bug fixed in AdminProvider.tsx: on a fresh browser
// (no prior cookies/session — exactly what a new Playwright context is), the
// Admin nav button used to not appear until a hard reload, because sign-in
// runs as a server action that redirects (a soft navigation) and never fires
// `onAuthStateChange` on the browser's own Supabase client. AdminProvider is
// mounted once in the root layout, so it kept the pre-login (signed-out)
// isAdmin it computed on the sign-in page. This test signs in once and
// asserts the button is visible immediately — no reload, no retry loop like
// e2e/articles/publish-flow.spec.ts's openAdminMenu() tolerates.

const PASSWORD = "Testpass12345";

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15_000 });
  await page.waitForLoadState("load");
}

test.describe("admin nav: first login in a fresh browser", () => {
  test.skip(!adminAvailable, "needs SUPABASE_SERVICE_ROLE_KEY");
  let userId = "";
  let email = "";

  test.beforeEach(async () => {
    email = `admin-nav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userId = data.user.id;
    const { error: permErr } = await admin!.from("admin_users").insert({ user_id: userId, permissions: [] });
    if (permErr) throw new Error(`grant: ${permErr.message}`);
  });

  test.afterEach(async () => {
    if (!userId) return;
    await admin!.from("admin_users").delete().eq("user_id", userId);
    const gone = await deleteTestUser(admin!, userId);
    expect(gone, "admin-nav test user leaked").toBe(true);
  });

  test("Admin button is visible right after sign-in, no reload needed", async ({ page, isMobile }) => {
    await signIn(page, email);

    if (isMobile) await page.locator("nav").locator('button[class*="lg:hidden"]').first().click();

    const adminToggle = page.getByRole("button", { name: "Admin", exact: true }).and(page.locator(":visible"));
    await expect(adminToggle).toBeVisible();
  });
});
