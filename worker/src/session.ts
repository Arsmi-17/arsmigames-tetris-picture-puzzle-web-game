import type { Env } from './env';

/**
 * Admin sign-in with the email and key from the environment (ADMIN_EMAIL,
 * ADMIN_KEY). A successful sign-in sets a signed, HttpOnly session cookie.
 * The signing key is derived from ADMIN_KEY, so changing the key signs every
 * session out.
 */

export interface AdminIdentity {
  email: string;
}

export const SESSION_COOKIE = '__Host-sr_admin';
export const SESSION_TTL_S = 12 * 60 * 60;
export const MIN_KEY_LENGTH = 12;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPTS = 10;
const MAX_TRACKED = 5000;
const attempts = new Map<string, { start: number; count: number }>();

const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return atob(base64);
}

function configured(env: Env): boolean {
  return Boolean(env.ADMIN_EMAIL && env.ADMIN_KEY && env.ADMIN_KEY.length >= MIN_KEY_LENGTH);
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`shape-reveal-session:${env.ADMIN_KEY}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Compare two strings without leaking where they differ. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [x, y] = await Promise.all([crypto.subtle.sign('HMAC', key, encoder.encode(a)), crypto.subtle.sign('HMAC', key, encoder.encode(b))]);
  const left = new Uint8Array(x);
  const right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

/** Too many failed sign-ins from this address recently. */
export function loginBlocked(request: Request): boolean {
  const entry = attempts.get(clientKey(request));
  return Boolean(entry && Date.now() - entry.start < LOGIN_WINDOW_MS && entry.count >= LOGIN_ATTEMPTS);
}

function recordFailure(request: Request): void {
  const key = clientKey(request);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.start >= LOGIN_WINDOW_MS) {
    if (attempts.size >= MAX_TRACKED) attempts.clear();
    attempts.set(key, { start: now, count: 1 });
  } else {
    entry.count += 1;
  }
}

/** Check submitted credentials. Returns the identity or null. */
export async function checkCredentials(request: Request, env: Env, email: unknown, key: unknown): Promise<AdminIdentity | null> {
  if (!configured(env) || typeof email !== 'string' || typeof key !== 'string') {
    recordFailure(request);
    return null;
  }
  const emailOk = await sameSecret(email.trim().toLowerCase(), env.ADMIN_EMAIL.trim().toLowerCase());
  const keyOk = await sameSecret(key, env.ADMIN_KEY);
  if (emailOk && keyOk) {
    attempts.delete(clientKey(request));
    return { email: env.ADMIN_EMAIL.trim().toLowerCase() };
  }
  recordFailure(request);
  return null;
}

/** Set-Cookie value for a new session. */
export async function createSessionCookie(env: Env, identity: AdminIdentity, now = Date.now()): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify({ email: identity.email, exp: Math.floor(now / 1000) + SESSION_TTL_S })));
  const signature = base64Url(await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload)));
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** The signed-in admin for this request, or null. Fails closed when not configured. */
export async function verifySession(request: Request, env: Env): Promise<AdminIdentity | null> {
  if (!configured(env)) return null;
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE.replace(/[-]/g, '\\-')}=([^;]+)`));
  if (!match) return null;
  const [payload, signature] = match[1].split('.');
  if (!payload || !signature) return null;
  try {
    const signatureBytes = Uint8Array.from(fromBase64Url(signature), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(env), signatureBytes, encoder.encode(payload));
    if (!valid) return null;
    const data = JSON.parse(fromBase64Url(payload)) as { email?: unknown; exp?: unknown };
    if (typeof data.email !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    if (data.email !== env.ADMIN_EMAIL.trim().toLowerCase()) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

/** Test hook. */
export function resetLoginAttempts(): void {
  attempts.clear();
}
