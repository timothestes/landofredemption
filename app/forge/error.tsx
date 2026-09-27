"use client";

import ErrorFallback from "@/components/ui/error-fallback";

export default function ForgeError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} label="Forge error" />;
}
