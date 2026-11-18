import { NextResponse, type NextRequest } from 'next/server';

/**
 * Strict Content-Security-Policy with a per-request nonce: only our own scripts run, nothing inline without
 * the nonce, the page cannot be framed, and the app may only talk to the ORVYN API.
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const ws = api.replace(/^http/, 'ws');
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets WebAssembly compile (the Vault's libsodium) without allowing eval() of scripts
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self'",
    // the in-app viewer plays voice notes and videos, and shows PDFs, from in-memory (blob:) copies
    "media-src 'self' blob:",
    "frame-src 'self' blob:",
    `connect-src 'self' ${api} ${ws}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    `form-action 'self' ${api}`,
  ].join('; ');
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon|icons|manifest|sw.js).*)' }],
};
