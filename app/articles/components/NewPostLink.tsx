"use client";

import Link from "next/link";
import { useIsAdmin } from "@/hooks/useIsAdmin";

// Per-viewer, so decided in the browser like EditLink. Shows "New post" to a
// poster (publish_posts) or the superuser; renders nothing for everyone else.
export default function NewPostLink() {
  const { isSuperuser, permissions, loading } = useIsAdmin();
  if (loading || !(isSuperuser || permissions.includes("publish_posts"))) return null;
  return (
    <Link
      href="/admin/posts/new"
      className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-input px-3 text-sm hover:bg-muted"
    >
      New post
    </Link>
  );
}
