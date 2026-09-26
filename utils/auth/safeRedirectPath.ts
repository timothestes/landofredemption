/**
 * Only ever redirect to a path on this site.
 *
 * `redirectTo` / `redirect_to` / `callbackUrl` arrive from the query string or
 * a form field, so anything an attacker can type ends up in `redirect()` or in
 * `${origin}${value}`. Accept a value only when it is a plain absolute path:
 * exactly one leading `/` (`//evil.com` is protocol-relative and `/\evil.com`
 * is normalised to it by browsers), no backslashes, no `@` before the first
 * `?` (`https://site.com@evil.com` sends the browser to evil.com), and no
 * control characters (CR/LF would split headers). Everything else — absolute
 * URLs, bare hosts, empty or non-string input — gets the fallback.
 */
export function safeRedirectPath(input: unknown, fallback = "/"): string {
  if (typeof input !== "string") return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//") || input.startsWith("/\\")) return fallback;
  if (input.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(input)) return fallback;
  if (input.split("?")[0].includes("@")) return fallback;
  return input;
}
