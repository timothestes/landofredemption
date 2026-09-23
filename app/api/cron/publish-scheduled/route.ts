import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidateArticles } from "@/app/articles/lib/revalidate";
import { validateForPublish } from "@/app/admin/posts/lib/validate";
import { sendCronAlert } from "@/lib/cron/alerts";

// Runs every 5 minutes (vercel.json) and publishes any draft whose
// scheduled_at has passed. No user session exists here, so posts_update_*
// RLS can't be satisfied — this is the one place in the app that needs the
// service-role client (see utils/supabase/admin.ts).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const sb = createAdminClient();
    const { data: due, error: selectError } = await sb
      .from("posts")
      .select("id, slug, title, body_md, scheduled_at")
      .eq("status", "draft")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", new Date().toISOString());
    if (selectError) throw new Error(`select due posts: ${selectError.message}`);

    const published: string[] = [];
    const skipped: string[] = [];
    for (const post of due ?? []) {
      // Re-check readiness: the poster may have emptied the title/body after
      // scheduling. Leave those as a pending schedule rather than publish
      // something broken; the poster sees it still sitting in "Scheduled".
      if (validateForPublish(post)) {
        skipped.push(post.id);
        continue;
      }
      const { error: updateError } = await sb
        .from("posts")
        .update({ status: "published", published_at: post.scheduled_at, scheduled_at: null, updated_at: new Date().toISOString() })
        .eq("id", post.id);
      if (updateError) throw new Error(`publish post ${post.id}: ${updateError.message}`);
      published.push(post.slug);
    }

    if (published.length > 0) revalidateArticles(published);
    return NextResponse.json({ success: true, published: published.length, skipped: skipped.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron] publish-scheduled failed:", message);
    await sendCronAlert("Publish Scheduled Posts", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
