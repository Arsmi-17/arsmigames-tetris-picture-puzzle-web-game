import type { Env } from './env';

/**
 * Verifies the Cloudflare Access JWT on admin requests. Access already blocks
 * unauthenticated visitors at the edge; this second check makes sure a
 * request really came through Access for this application, so a missing or
 * misconfigured Access rule cannot expose the admin API.
 */

export interface AdminIdentity {
  email: string;
}

interface Jwk extends JsonWebKey {
  kid: string;
}

interface CachedKeys {
  fetchedAt: number;
  keys: Map<string, CryptoKey>;
}

const KEY_CACHE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const keyCache = new Map<string, CachedKeys>();

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as Record<string, unknown>;
}

async function signingKeys(teamDomain: string, forceRefresh: boolean): Promise<Map<string, CryptoKey>> {
  const cached = keyCache.get(teamDomain);
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt < KEY_CACHE_MS) return cached.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs request failed: ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keyCache.set(teamDomain, { fetchedAt: Date.now(), keys });
  return keys;
}

function cookieToken(request: Request): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

function isLocalHost(request: Request): boolean {
  const { hostname } = new URL(request.url);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Returns the admin identity, or null if the request is not authenticated. */
export async function verifyAdmin(request: Request, env: Env): Promise<AdminIdentity | null> {
  if (env.DEV_ADMIN_EMAIL && isLocalHost(request)) return { email: env.DEV_ADMIN_EMAIL };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null; // fail closed

  const token = request.headers.get('cf-access-jwt-assertion') ?? cookieToken(request);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    let key = (await signingKeys(env.ACCESS_TEAM_DOMAIN, false)).get(header.kid);
    // Access rotates keys; refresh once for an unknown kid.
    if (!key) key = (await signingKeys(env.ACCESS_TEAM_DOMAIN, true)).get(header.kid);
    if (!key) return null;

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;

    const now = Math.floor(Date.now() / 1000);
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audience.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (typeof payload.exp !== 'number' || payload.exp < now - CLOCK_SKEW_S) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now + CLOCK_SKEW_S) return null;
    if (typeof payload.email !== 'string' || !payload.email) return null;

    const email = payload.email.toLowerCase();
    const allowlist = (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (allowlist.length > 0 && !allowlist.includes(email)) return null;
    return { email };
  } catch {
    return null;
  }
}

/** Test hook: forget cached Access signing keys. */
export function clearAccessKeyCache(): void {
  keyCache.clear();
}
