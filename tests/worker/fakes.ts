import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Env } from '../../worker/src/env';

type Value = string | number | null | bigint | Uint8Array;

// Vite 5 does not know node:sqlite as a builtin, so load it through require.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** Minimal D1 stand-in backed by node:sqlite, running the real migrations. */
export function createD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../migrations/0001_catalog.sql', import.meta.url), 'utf8'));

  const statement = (sql: string, params: Value[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values.map((v) => (v === undefined ? null : v)) as Value[]),
    first: async <T>() => (db.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[], success: true, meta: {} }),
    run: async () => {
      db.prepare(sql).run(...params);
      return { success: true, meta: {}, results: [] };
    },
  });

  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const s of stmts) results.push(await s.run());
        db.exec('COMMIT');
        return results;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

export interface FakeBucket extends R2Bucket {
  objects: Map<string, string>;
  failPuts: boolean;
}

export function createR2(): FakeBucket {
  const objects = new Map<string, string>();
  const bucket = {
    objects,
    failPuts: false,
    async put(key: string, value: string) {
      if (bucket.failPuts) throw new Error('R2 unavailable');
      objects.set(key, value);
      return {};
    },
    async get(key: string) {
      const value = objects.get(key);
      if (value === undefined) return null;
      return { body: value, httpEtag: `"${value.length}"` };
    },
  };
  return bucket as unknown as FakeBucket;
}

export function installCaches(): Map<string, Response> {
  const store = new Map<string, Response>();
  (globalThis as unknown as { caches: unknown }).caches = {
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { store.set(req.url, res); },
      delete: async (req: Request) => store.delete(req.url),
    },
  };
  return store;
}

export const ctx = { waitUntil: (p: Promise<unknown>) => { void p; }, passThroughOnException() {} } as unknown as ExecutionContext;

export const TEAM = 'testteam.cloudflareaccess.com';
export const AUD = 'test-aud-123';
export const ORIGIN = 'https://play.example.com';
export const IMAGE_HOST = 'images.example.com';

export function createEnv(overrides: Partial<Env> = {}): Env & { CATALOG_BUCKET: FakeBucket } {
  return {
    ASSETS: { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`, { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher,
    DB: createD1(),
    CATALOG_BUCKET: createR2(),
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    IMAGE_HOSTS: IMAGE_HOST,
    GAME_ORIGIN: ORIGIN,
    ...overrides,
  } as Env & { CATALOG_BUCKET: FakeBucket };
}

const b64url = (data: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer)).toString('base64url');

export interface TestSigner {
  jwks: { keys: JsonWebKey[] };
  sign: (claims: Record<string, unknown>, kid?: string) => Promise<string>;
}

export async function createSigner(kid = 'key-1'): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    jwks: { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' } as JsonWebKey] },
    async sign(claims, signKid = kid) {
      const header = b64url(JSON.stringify({ alg: 'RS256', kid: signKid, typ: 'JWT' }));
      const payload = b64url(JSON.stringify(claims));
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
      return `${header}.${payload}.${b64url(signature)}`;
    },
  };
}

export function validClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { aud: [AUD], iss: `https://${TEAM}`, email: 'Admin@Example.com', iat: now, nbf: now - 5, exp: now + 600, ...overrides };
}

/** A real PNG header for a width×height image. */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

export interface FakeImage {
  status?: number;
  type?: string;
  bytes?: number;
  width?: number;
  height?: number;
  cors?: string | null;
  cacheControl?: string;
  body?: Uint8Array;
}
