// app/admin/posts/components/AuthorProfileCard.tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import ToastNotification from "@/components/ui/toast-notification";
import { createClient } from "@/utils/supabase/client";
import { ACCEPT, validateMediaFile } from "../lib/media";
import { updateAuthorProfileAction } from "../lib/authorProfile";

const MAX_BIO = 500;
const MAX_USERNAME = 40;
const LABEL = "block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

type Toast = { message: string; type: "success" | "error" } | null;

export default function AuthorProfileCard({
  username: initialUsername,
  initialAvatarUrl,
  initialBio,
}: {
  username: string | null;
  initialAvatarUrl: string | null;
  initialBio: string | null;
}) {
  const [username, setUsername] = useState(initialUsername ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [bio, setBio] = useState(initialBio ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = validateMediaFile(file, "image");
    if (problem) {
      setToast({ message: problem, type: "error" });
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const fileName = `poster-${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(fileName, file);
    setUploading(false);
    if (upErr) {
      setToast({ message: "Avatar upload failed", type: "error" });
      return;
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(fileName);
    setAvatarUrl(publicUrl);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    const r = await updateAuthorProfileAction(bio, avatarUrl, username);
    setSaving(false);
    if (r.success === false) {
      setToast({ message: r.error, type: "error" });
    } else {
      setDirty(false);
      setToast({ message: "Author profile saved", type: "success" });
    }
  }

  return (
    <div className="mb-8 rounded-lg bg-card p-4">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Your author profile
      </h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">
              {username?.slice(0, 1).toUpperCase() ?? "?"}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Change photo"}
          </Button>
          <input ref={fileInput} type="file" accept={ACCEPT.image} className="hidden" onChange={handleAvatarPick} />
        </div>
        <div className="flex-1">
          <label className={LABEL}>
            Name on your articles
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.slice(0, MAX_USERNAME));
                setDirty(true);
              }}
              maxLength={MAX_USERNAME}
              placeholder="How your name appears in the byline"
              className="mb-3 mt-1 min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm normal-case tracking-normal outline-none"
            />
          </label>
          <label className={LABEL}>
            Bio ({bio.length}/{MAX_BIO})
            <textarea
              value={bio}
              onChange={(e) => {
                setBio(e.target.value.slice(0, MAX_BIO));
                setDirty(true);
              }}
              placeholder="A sentence or two about you — shown on every article you publish."
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-input bg-background p-2 text-sm outline-none"
            />
          </label>
          <Button type="button" className="mt-2 min-h-11" onClick={save} disabled={saving || uploading || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      <ToastNotification show={toast !== null} message={toast?.message ?? ""} type={toast?.type} onClose={() => setToast(null)} />
    </div>
  );
}
