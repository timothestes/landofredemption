import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  GAME_BACKGROUND_MAX_BYTES,
  GAME_BACKGROUND_PREFIX,
  GAME_BACKGROUND_TYPES,
  isOwnBackgroundPathname,
} from "@/app/shared/utils/gameBackground";

// Client-upload token route for a player's custom game background. The browser
// resizes and re-encodes before it gets here, but the limits below are what
// Vercel actually enforces, so a hand-rolled upload is still capped.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized: sign in to upload a background");
        if (!isOwnBackgroundPathname(pathname, user.id)) throw new Error("Bad upload path");

        // Bound storage at one saved image plus the one about to land: sweep
        // every other blob in this user's folder (abandoned uploads, a
        // replacement whose old file the save action failed to delete).
        const { data: row } = await supabase
          .from("game_backgrounds")
          .select("url")
          .eq("user_id", user.id)
          .maybeSingle();
        const { blobs } = await list({ prefix: `${GAME_BACKGROUND_PREFIX}/${user.id}/`, token: process.env.BLOB_READ_WRITE_TOKEN });
        const stale = blobs.map((b) => b.url).filter((u) => u !== row?.url);
        if (stale.length) await del(stale, { token: process.env.BLOB_READ_WRITE_TOKEN });

        return {
          allowedContentTypes: [...GAME_BACKGROUND_TYPES],
          maximumSizeInBytes: GAME_BACKGROUND_MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    const status = message.startsWith("Unauthorized") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
