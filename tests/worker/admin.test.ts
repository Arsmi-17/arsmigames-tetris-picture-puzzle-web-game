import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../worker/src/index';
import { clearAccessKeyCache } from '../../worker/src/access';
import { readDimensions } from '../../worker/src/images';
import { parseCatalog } from '../../shared/catalog';
import {
  AUD, IMAGE_HOST, ORIGIN, TEAM, createEnv, createSigner, ctx, installCaches, pngHeader, validClaims,
  type FakeImage, type TestSigner,
} from './fakes';

const SITE = 'https://play.example.com';
let signer: TestSigner;
let images: Map<string, FakeImage>;
let env: ReturnType<typeof createEnv>;
let token: string;

beforeAll(async () => {
  signer = await createSigner();
});

beforeEach(async () => {
  clearAccessKeyCache();
  installCaches();
  env = createEnv();
  token = await signer.sign(validClaims());
  images = new Map([
    [`https://${IMAGE_HOST}/pics/lake-v1.png`, {}],
    [`https://${IMAGE_HOST}/pics/lake-v2.png`, {}],
    [`https://${IMAGE_HOST}/pics/forest-v1.png`, {}],
    [`https://${IMAGE_HOST}/thumbs/lake.png`, { width: 256, height: 256, bytes: 30_000 }],
  ]);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json(signer.jwks);
    const image = images.get(url);
    if (!image) return new Response('missing', { status: 404 });
    const origin = new Headers(init?.headers).get('origin');
    const headers = new Headers({
      'content-type': image.type ?? 'image/png',
      'content-length': String(image.bytes ?? 400_000),
      'cache-control': image.cacheControl ?? 'public, max-age=31536000, immutable',
    });
    const cors = image.cors === undefined ? '*' : image.cors;
    if (cors && origin) headers.set('access-control-allow-origin', cors);
    return new Response(image.body ?? pngHeader(image.width ?? 1200, image.height ?? 1200), { status: image.status ?? 200, headers });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function api(path: string, init: { method?: string; body?: unknown; auth?: string | null; origin?: string | null } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const auth = init.auth === undefined ? token : init.auth;
  if (auth) headers.set('cf-access-jwt-assertion', auth);
  const origin = init.origin === undefined ? SITE : init.origin;
  if (origin && (init.method ?? 'GET') !== 'GET') headers.set('origin', origin);
  return handleRequest(new Request(`${SITE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), env, ctx);
}

const lake = {
  title: 'Mountain Lake',
  theme: 'Calm',
  url: `https://${IMAGE_HOST}/pics/lake-v1.png`,
  thumbUrl: `https://${IMAGE_HOST}/thumbs/lake.png`,
  alt: 'A blue lake below snowy peaks.',
  attribution: 'Photo by A. Admin',
  license: 'CC BY 4.0',
  minChallenge: 0,
  maxChallenge: 5,
};

async function createPicture(body: Record<string, unknown> = lake) {
  const response = await api('/api/admin/pictures', { method: 'POST', body });
  expect(response.status).toBe(201);
  return (await response.json() as { picture: { id: string; status: string } }).picture;
}

async function publicCatalog() {
  const response = await handleRequest(new Request(`${SITE}/catalog.json`), env, ctx);
  return { status: response.status, catalog: parseCatalog(await response.json()), cacheControl: response.headers.get('cache-control') };
}

describe('admin authentication', () => {
  it('rejects anonymous reads and writes', async () => {
    expect((await api('/api/admin/pictures', { auth: null })).status).toBe(401);
    expect((await api('/api/admin/pictures', { method: 'POST', body: lake, auth: null })).status).toBe(401);
    expect((await api('/api/admin/publish', { method: 'POST', auth: null })).status).toBe(401);
    expect((await handleRequest(new Request(`${SITE}/admin/`), env, ctx)).status).toBe(401);
    expect(env.CATALOG_BUCKET.objects.size).toBe(0);
  });

  it('rejects tokens with a bad signature, audience, issuer, expiry or unknown key', async () => {
    const other = await createSigner('key-1');
    const cases = [
      await other.sign(validClaims()),
      await signer.sign(validClaims({ aud: ['someone-else'] })),
      await signer.sign(validClaims({ iss: 'https://evil.cloudflareaccess.com' })),
      await signer.sign(validClaims({ exp: Math.floor(Date.now() / 1000) - 3600 })),
      await signer.sign(validClaims(), 'unknown-kid'),
      await signer.sign(validClaims({ email: undefined })),
      'not.a.jwt',
    ];
    for (const bad of cases) {
      expect((await api('/api/admin/me', { auth: bad })).status).toBe(401);
    }
  });

  it('accepts a valid Access token, from the header or the cookie', async () => {
    const response = await api('/api/admin/me');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'admin@example.com' });
    const viaCookie = await handleRequest(new Request(`${SITE}/api/admin/me`, { headers: { cookie: `CF_Authorization=${token}` } }), env, ctx);
    expect(viaCookie.status).toBe(200);
  });

  it('fails closed when Access is not configured', async () => {
    env = createEnv({ ACCESS_AUD: '' });
    expect((await api('/api/admin/me')).status).toBe(401);
  });

  it('applies the optional email allowlist', async () => {
    env = createEnv({ ADMIN_EMAILS: 'someone@example.com' });
    expect((await api('/api/admin/me')).status).toBe(401);
    env = createEnv({ ADMIN_EMAILS: 'someone@example.com, admin@example.com' });
    expect((await api('/api/admin/me')).status).toBe(200);
  });

  it('only honours the dev admin email on localhost', async () => {
    env = createEnv({ DEV_ADMIN_EMAIL: 'dev@example.com' });
    expect((await handleRequest(new Request(`${SITE}/api/admin/me`), env, ctx)).status).toBe(401);
    const local = await handleRequest(new Request('http://localhost:8787/api/admin/me'), env, ctx);
    expect(local.status).toBe(200);
  });

  it('refuses cross-origin writes even with a valid token', async () => {
    expect((await api('/api/admin/pictures', { method: 'POST', body: lake, origin: 'https://evil.example' })).status).toBe(403);
    expect((await api('/api/admin/pictures', { method: 'POST', body: lake, origin: null })).status).toBe(403);
  });

  it('serves the admin page with no-store and anti-framing headers', async () => {
    const response = await handleRequest(new Request(`${SITE}/admin/`, { headers: { 'cf-access-jwt-assertion': token } }), env, ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('catalog publishing', () => {
  it('drafts stay private; publishing writes the public catalog', async () => {
    expect((await publicCatalog()).status).toBe(404);
    const picture = await createPicture();
    expect(picture.status).toBe('draft');
    expect(env.CATALOG_BUCKET.objects.size).toBe(0);

    const published = await api(`/api/admin/pictures/${picture.id}/publish`, { method: 'POST' });
    const body = await published.json() as { catalog: { status: string; version: number } };
    expect(body.catalog.status).toBe('succeeded');

    const { catalog, cacheControl } = await publicCatalog();
    expect(cacheControl).toMatch(/max-age=60/);
    expect(catalog?.pictures).toEqual([{
      id: picture.id, title: lake.title, theme: lake.theme, url: lake.url, thumbUrl: lake.thumbUrl,
      alt: lake.alt, attribution: lake.attribution, license: lake.license, minChallenge: 0, maxChallenge: 5,
    }]);
    expect(env.CATALOG_BUCKET.objects.has(`catalog/v${body.catalog.version}.json`)).toBe(true);
  });

  it('edits to a published picture, reorder and unpublish all refresh the catalog', async () => {
    const a = await createPicture();
    const b = await createPicture({ ...lake, title: 'Forest', url: `https://${IMAGE_HOST}/pics/forest-v1.png`, thumbUrl: undefined });
    await api(`/api/admin/pictures/${a.id}/publish`, { method: 'POST' });
    await api(`/api/admin/pictures/${b.id}/publish`, { method: 'POST' });
    installCaches(); // each test read below bypasses the edge cache

    const edited = await api(`/api/admin/pictures/${a.id}`, { method: 'PUT', body: { ...lake, title: 'Lake at Dawn', url: `https://${IMAGE_HOST}/pics/lake-v2.png` } });
    expect(edited.status).toBe(200);
    let { catalog } = await publicCatalog();
    expect(catalog?.pictures.map((p) => p.title)).toEqual(['Lake at Dawn', 'Forest']);
    expect(catalog?.pictures[0].url).toBe(`https://${IMAGE_HOST}/pics/lake-v2.png`);

    installCaches();
    expect((await api('/api/admin/reorder', { method: 'POST', body: { ids: [b.id, a.id] } })).status).toBe(200);
    ({ catalog } = await publicCatalog());
    expect(catalog?.pictures.map((p) => p.id)).toEqual([b.id, a.id]);

    installCaches();
    await api(`/api/admin/pictures/${b.id}/unpublish`, { method: 'POST' });
    ({ catalog } = await publicCatalog());
    expect(catalog?.pictures.map((p) => p.id)).toEqual([a.id]);
  });

  it('a failed catalog write is reported, marks the catalog stale, and can be retried', async () => {
    const picture = await createPicture();
    env.CATALOG_BUCKET.failPuts = true;
    const response = await api(`/api/admin/pictures/${picture.id}/publish`, { method: 'POST' });
    const body = await response.json() as { picture: { status: string }; catalog: { status: string; error: string } };
    expect(body.picture.status).toBe('published');
    expect(body.catalog.status).toBe('failed');
    expect(body.catalog.error).toContain('R2 unavailable');

    let status = await (await api('/api/admin/status')).json() as { stale: boolean; latest: { status: string } };
    expect(status.stale).toBe(true);
    expect(status.latest.status).toBe('failed');

    expect((await api('/api/admin/publish', { method: 'POST' })).status).toBe(502);
    env.CATALOG_BUCKET.failPuts = false;
    expect((await api('/api/admin/publish', { method: 'POST' })).status).toBe(200);
    status = await (await api('/api/admin/status')).json() as { stale: boolean; latest: { status: string } };
    expect(status.stale).toBe(false);
    expect((await publicCatalog()).catalog?.pictures).toHaveLength(1);
  });

  it('draft edits do not mark the catalog stale', async () => {
    const picture = await createPicture();
    await api('/api/admin/publish', { method: 'POST' });
    await api(`/api/admin/pictures/${picture.id}`, { method: 'PUT', body: { ...lake, title: 'Renamed draft' } });
    const status = await (await api('/api/admin/status')).json() as { stale: boolean };
    expect(status.stale).toBe(false);
  });

  it('records an audit trail', async () => {
    const picture = await createPicture();
    await api(`/api/admin/pictures/${picture.id}/publish`, { method: 'POST' });
    const { results } = await env.DB.prepare('SELECT actor, action FROM audit_log ORDER BY id').all<{ actor: string; action: string }>();
    expect(results).toEqual([{ actor: 'admin@example.com', action: 'create' }, { actor: 'admin@example.com', action: 'publish' }]);
  });
});

describe('picture validation', () => {
  async function check(url: string, extra: Record<string, unknown> = {}) {
    const response = await api('/api/admin/check-image', { method: 'POST', body: { url, ...extra } });
    return response.json() as Promise<{ ok: boolean; image: { errors: string[]; warnings: string[]; width?: number } }>;
  }

  it('accepts a square, CORS-enabled image on the approved host', async () => {
    const result = await check(lake.url);
    expect(result.ok).toBe(true);
    expect(result.image.width).toBe(1200);
  });

  it.each([
    ['an unapproved host', 'https://elsewhere.example.com/a.png', {}, /hosted on images.example.com/],
    ['an r2.dev host', 'https://pub-123.r2.dev/a.png', {}, /hosted on|r2.dev/],
    ['plain http', `http://${IMAGE_HOST}/pics/lake-v1.png`, {}, /https/],
    ['a missing file', `https://${IMAGE_HOST}/missing.png`, {}, /HTTP 404/],
  ])('rejects %s', async (_name, url, _img, message) => {
    const result = await check(url);
    expect(result.ok).toBe(false);
    expect(result.image.errors.join(' ')).toMatch(message);
  });

  it.each([
    ['no CORS header', { cors: null }, /CORS/],
    ['CORS for another origin', { cors: 'https://other.example' }, /CORS/],
    ['a non-square image', { width: 1600, height: 900 }, /square/],
    ['a tiny image', { width: 300, height: 300 }, /at least 512/],
    ['an oversized file', { bytes: 9 * 1024 * 1024 }, /limit is 5.0 MB/],
    ['an unsupported type', { type: 'image/svg+xml' }, /Unsupported file type/],
    ['unreadable bytes', { body: new Uint8Array(64) }, /dimensions/],
  ])('rejects %s', async (_name, image, message) => {
    const url = `https://${IMAGE_HOST}/pics/test.png`;
    images.set(url, image as never);
    const result = await check(url);
    expect(result.ok).toBe(false);
    expect(result.image.errors.join(' ')).toMatch(message);
  });

  it('warns about short cache lifetimes and very large images', async () => {
    const url = `https://${IMAGE_HOST}/pics/big.png`;
    images.set(url, { width: 4000, height: 4000, cacheControl: 'max-age=60' });
    const result = await check(url);
    expect(result.ok).toBe(true);
    expect(result.image.warnings.join(' ')).toMatch(/cache lifetime/);
    expect(result.image.warnings.join(' ')).toMatch(/larger than phones need/);
  });

  it('rejects duplicates and invalid details on save', async () => {
    await createPicture();
    const duplicate = await api('/api/admin/pictures', { method: 'POST', body: { ...lake, title: 'Copy' } });
    expect(duplicate.status).toBe(422);
    const invalid = await api('/api/admin/pictures', { method: 'POST', body: { ...lake, title: '', minChallenge: 6, maxChallenge: 2 } });
    expect(invalid.status).toBe(400);
    const errors = (await invalid.json() as { errors: string[] }).errors;
    expect(errors.join(' ')).toMatch(/title is required/);
    expect(errors.join(' ')).toMatch(/minChallenge must not be above/);
  });

  it('requires JSON bodies for writes', async () => {
    const response = await handleRequest(new Request(`${SITE}/api/admin/pictures`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: SITE, 'cf-access-jwt-assertion': token },
      body: JSON.stringify(lake),
    }), env, ctx);
    expect(response.status).toBe(400);
  });

  it('re-checks the image at publish time', async () => {
    const picture = await createPicture();
    images.set(lake.url, { cors: null });
    const response = await api(`/api/admin/pictures/${picture.id}/publish`, { method: 'POST' });
    expect(response.status).toBe(422);
    expect(env.CATALOG_BUCKET.objects.size).toBe(0);
  });
});

describe('image header parsing', () => {
  it('reads JPEG dimensions from the frame header', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x04, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(readDimensions(jpeg)).toEqual({ width: 1024, height: 800 });
  });

  it('reads WebP VP8X dimensions', () => {
    const webp = new Uint8Array(40);
    webp.set(new TextEncoder().encode('RIFF'), 0);
    webp.set(new TextEncoder().encode('WEBP'), 8);
    webp.set(new TextEncoder().encode('VP8X'), 12);
    webp.set([0xff, 0x03, 0x00, 0xff, 0x03, 0x00], 24); // 1024 - 1
    expect(readDimensions(webp)).toEqual({ width: 1024, height: 1024 });
  });
});

describe('public routes', () => {
  it('serves the game assets and 404s unknown API paths', async () => {
    expect(await (await handleRequest(new Request(`${SITE}/`), env, ctx)).text()).toBe('asset:/');
    expect((await handleRequest(new Request(`${SITE}/api/nope`), env, ctx)).status).toBe(404);
  });

  it('keeps AUD constant visible to tests', () => {
    expect(AUD).toBeTruthy();
    expect(ORIGIN).toBe(SITE);
  });
});
