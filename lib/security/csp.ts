/**
 * Content Security Policy with a per-request nonce. Next.js reads the nonce
 * from the request's CSP header and adds it to its own scripts, so every
 * page is rendered per request (docs/adr/0002). `strict-dynamic` lets those
 * scripts load their chunks; no other inline script is allowed.
 */
export function buildCsp(nonce: string, options: { dev: boolean; supabaseUrl?: string }): string {
  const supabase = options.supabaseUrl ? new URL(options.supabaseUrl) : null;
  const connect = ["'self'"];
  if (supabase) connect.push(supabase.origin, `wss://${supabase.host}`);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(options.dev ? ["'unsafe-eval'"] : [])],
    // Tailwind and Next inject style attributes; styles cannot run code.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": options.dev ? [...connect, "ws:"] : connect,
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!options.dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
