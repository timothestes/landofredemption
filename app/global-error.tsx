"use client";

import { useEffect } from "react";

// Catches a failure in the root layout itself, so nothing from app/layout.tsx can be assumed:
// no globals.css tokens, no fonts, no ThemeProvider. It renders its own <html>/<body> with
// inline styles and follows the OS colour scheme by hand (hex values are the light/dark
// --background/--card/--border/--muted-foreground/--primary tokens from globals.css).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 16px",
          boxSizing: "border-box",
          background: "#ffffff",
          color: "#0a0a0a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <style>{`
          .ge-card { background: #ffffff; border: 1px solid #e5e5e5; }
          .ge-muted { color: #737373; }
          .ge-btn { background: #157f4d; color: #fafafa; }
          .ge-link { color: #737373; }
          .ge-link:hover { color: inherit; }
          @media (prefers-color-scheme: dark) {
            body { background: #111827 !important; color: #f0f2f4 !important; }
            .ge-card { background: #14161a; border-color: #292d32; }
            .ge-muted, .ge-link { color: #838b95; }
            .ge-btn { background: #21c45d; }
          }
        `}</style>
        <div
          className="ge-card"
          style={{ width: "100%", maxWidth: 384, borderRadius: 8, padding: 32, textAlign: "center" }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600 }}>Something went wrong</p>
          <p className="ge-muted" style={{ margin: 0, fontSize: 14 }}>
            The site failed to load. Please try again.
          </p>
          <div
            style={{
              marginTop: 24,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              className="ge-btn"
              style={{
                border: 0,
                borderRadius: 6,
                height: 40,
                padding: "0 16px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a href="/" className="ge-link" style={{ fontSize: 14, textDecoration: "none" }}>
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
