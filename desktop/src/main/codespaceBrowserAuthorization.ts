import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const CODESPACE_BROWSER_COOKIE = 'redeven_codespace_browser';
export const CODESPACE_BROWSER_ENTRY_PATH = '/_redeven_codespace_browser';
export const CODESPACE_BROWSER_SESSION_MS = 12 * 60 * 60 * 1000;

function equal(actual: string | undefined, expected: string): boolean {
  const bytes = Buffer.from(actual ?? '');
  const secret = Buffer.from(expected);
  return bytes.length === secret.length && timingSafeEqual(bytes, secret);
}

/** Authority belongs to one gateway and its already authorized editor generation. */
export class CodeSpaceBrowserAuthorization {
  private pending?: { path: string; expires: number };
  private readonly cookie = randomBytes(32).toString('base64url');
  private readonly expires: number;

  constructor(private readonly now: () => number = Date.now) {
    this.expires = now() + CODESPACE_BROWSER_SESSION_MS;
  }

  mint(origin: string): string {
    if (this.now() >= this.expires) throw new Error('codespace_closed');
    const path = `${CODESPACE_BROWSER_ENTRY_PATH}?entry=${randomBytes(32).toString('base64url')}`;
    this.pending = { path, expires: this.now() + 60_000 };
    return origin + path;
  }

  redeem(request: IncomingMessage, response: ServerResponse): boolean {
    if (request.url?.split('?')[0] !== CODESPACE_BROWSER_ENTRY_PATH)
      return false;
    const pending = this.pending;
    this.pending = undefined;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (
      request.method !== 'GET' ||
      !pending ||
      this.now() >= pending.expires ||
      this.now() >= this.expires ||
      !equal(request.url, pending.path)
    ) {
      response.writeHead(401);
      response.end('invalid or expired codespace entry');
      return true;
    }
    response.setHeader(
      'Set-Cookie',
      `${CODESPACE_BROWSER_COOKIE}=${this.cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((this.expires - this.now()) / 1000)}`,
    );
    response.writeHead(303, { Location: '/' });
    response.end();
    return true;
  }

  authorize(
    request: IncomingMessage,
    origin: string,
    upgrade: boolean,
  ): boolean {
    if (this.now() >= this.expires) return false;
    const values = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(CODESPACE_BROWSER_COOKIE + '='));
    if (
      values.length !== 1 ||
      !equal(values[0]?.slice(CODESPACE_BROWSER_COOKIE.length + 1), this.cookie)
    )
      return false;
    if (request.headers['sec-fetch-site'] === 'cross-site') return false;
    const suppliedOrigin = request.headers.origin;
    if (suppliedOrigin !== undefined && suppliedOrigin !== origin) return false;
    return (
      (!upgrade && (request.method === 'GET' || request.method === 'HEAD')) ||
      suppliedOrigin === origin
    );
  }
}

export function stripCodeSpaceBrowserCookie(cookie: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter(
      (part) => part && part.split('=')[0]?.trim() !== CODESPACE_BROWSER_COOKIE,
    )
    .join('; ');
}
