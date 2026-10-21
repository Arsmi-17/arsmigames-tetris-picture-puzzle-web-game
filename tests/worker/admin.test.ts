import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../worker/src/index';
import { readDimensions } from '../../worker/src/images';
import { resetLoginAttempts, SESSION_COOKIE } from '../../worker/src/session';
import { parseCatalog } from '../../shared/catalog';
import {
  ADMIN_EMAIL, ADMIN_KEY, IMAGE_HOST, ORIGIN, createEnv, createMemoryStore, ctx, installCaches, pngHeader,
  type FakeImage, type MemoryStore,
} from './fakes';

const SITE = 'https://play.example.com';
let images: Map<string, FakeImage>;
let env: ReturnType<typeof createEnv>;
let store: MemoryStore;
let cookie: string;

function send(request: Request) {
  return handleRequest(request, env, ctx, { store });
}

async function signIn(email = ADMIN_EMAIL, key = ADMIN_KEY, ip = '203.0.113.1') {
  return send(new Request(`${SITE}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, 'cf-connecting-ip': ip },
    body: JSON.stringify({ email, key }),
  }));
}

function sessionFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return header.split(';')[0];
}

beforeEach(async () => {
  resetLoginAttempts();
  installCaches();
  env = createEnv();
  store = createMemoryStore();
  images = new Map([
    [`https://${IMAGE_HOST}/pics/lake-v1.png`, {}],
    [`https://${IMAGE_HOST}/pics/lake-v2.png`, {}],
    [`https://${IMAGE_HOST}/pics/forest-v1.png`, {}],
    [`https://${IMAGE_HOST}/thumbs/lake.png`, { width: 256, height: 256, bytes: 30_000 }],
  ]);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
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
  cookie = sessionFrom(await signIn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function api(path: string, init: { method?: string; body?: unknown; session?: string | null; origin?: string | null } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const session = init.session === undefined ? cookie : init.session;
  if (session) headers.set('cookie', session);
  const origin = init.origin === undefined ? SITE : init.origin;
  if (origin && (init.method ?? 'GET') !== 'GET') headers.set('origin', origin);
  return send(new Request(`${SITE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
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
  installCaches(); // read through to the store, not this location's cache
  const response = await send(new Request(`${SITE}/catalog.json`));
  return { status: response.status, catalog: parseCatalog(await response.json()), cacheControl: response.headers.get('cache-control') };
}

describe('admin sign-in', () => {
  it('signs in with the email (any case) and key from the environment', async () => {
    const response = await signIn('  admin@EXAMPLE.com ', ADMIN_KEY);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(await (await api('/api/admin/me', { session: sessionFrom(response) })).json()).toEqual({ email: 'admin@example.com' });
  });

  it('rejects a wrong key or email', async () => {
    expect((await signIn(ADMIN_EMAIL, 'wrong-key-1234')).status).toBe(401);
    expect((await signIn('someone@example.com', ADMIN_KEY)).status).toBe(401);
    expect((await signIn(ADMIN_EMAIL, '')).status).toBe(401);
  });

  it('locks out an address after repeated failures', async () => {
    for (let i = 0; i < 10; i += 1) await signIn(ADMIN_EMAIL, `wrong-${i}-xxxxxxx`, '198.51.100.20');
    const blocked = await signIn(ADMIN_EMAIL, ADMIN_KEY, '198.51.100.20');
    expect(blocked.status).toBe(429);
    expect((await signIn(ADMIN_EMAIL, ADMIN_KEY, '198.51.100.21')).status).toBe(200);
  });

  it('refuses cross-site sign-in', async () => {
    const response = await send(new Request(`${SITE}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: ADMIN_EMAIL, key: ADMIN_KEY }),
    }));
    expect(response.status).toBe(403);
  });

  it('fails closed, and says so, when the admin email or key is missing or too short', async () => {
    for (const overrides of [{ ADMIN_EMAIL: '' }, { ADMIN_KEY: '' }, { ADMIN_KEY: 'short' }, { ADMIN_KEY: undefined as unknown as string }]) {
      env = createEnv(overrides);
      const response = await signIn(ADMIN_EMAIL, overrides.ADMIN_KEY ?? ADMIN_KEY);
      expect(response.status).toBe(503);
      expect((await response.json() as { error: string }).error).toMatch(/not set up on this deployment/);
      expect(await (await send(new Request(`${SITE}/api/admin/login`))).json()).toEqual({ configured: false });
      expect((await api('/api/admin/me')).status).toBe(401);
    }
    env = createEnv();
    expect(await (await send(new Request(`${SITE}/api/admin/login`))).json()).toEqual({ configured: true });
  });

  it('accepts the values from the screenshot, with stray spaces around them', async () => {
    env = createEnv({ ADMIN_EMAIL: 'admin.arsmi@gmail.com', ADMIN_KEY: 'admin@arsmi17 ' });
    expect((await signIn('Admin.Arsmi@gmail.com ', ' admin@arsmi17')).status).toBe(200);
  });

  it('rejects missing, forged, tampered or expired sessions', async () => {
    const [name, value] = cookie.split('=');
    const [payload, signature] = value.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ email: 'admin@example.com', exp: 9_999_999_999 })).toString('base64url');
    const expiredPayload = Buffer.from(JSON.stringify({ email: 'admin@example.com', exp: 1 })).toString('base64url');
    for (const session of [null, `${name}=${forgedPayload}.${signature}`, `${name}=${payload}.AAAA`, `${name}=${expiredPayload}.${signature}`, `${name}=garbage`]) {
      expect((await api('/api/admin/me', { session })).status).toBe(401);
    }
  });

  it('changing the admin key signs existing sessions out', async () => {
    env = createEnv({ ADMIN_KEY: 'a-brand-new-admin-key' });
    expect((await api('/api/admin/me')).status).toBe(401);
  });

  it('sign-out clears the cookie', async () => {
    const response = await api('/api/admin/logout', { method: 'POST' });
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('rejects anonymous reads and writes', async () => {
    expect((await api('/api/admin/pictures', { session: null })).status).toBe(401);
    expect((await api('/api/admin/pictures', { method: 'POST', body: lake, session: null })).status).toBe(401);
    expect((await api('/api/admin/publish', { method: 'POST', session: null })).status).toBe(401);
    expect(store.pictures).toHaveLength(0);
  });

  it('refuses cross-origin writes even when signed in', async () => {
    expect((await api('/api/admin/pictures', { method: 'POST', body: lake, origin: 'https://evil.example' })).status).toBe(403);
    expect((await api('/api/admin/pictures', { method: 'POST', body: lake, origin: null })).status).toBe(403);
  });

  it('serves the admin page (with its sign-in form) without caching or framing', async () => {
    const response = await send(new Request(`${SITE}/admin/`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('catalog publishing', () => {
  it('drafts stay private; publishing makes the picture public', async () => {
    expect((await publicCatalog()).catalog?.pictures).toEqual([]);
    const picture = await createPicture();
    expect(picture.status).toBe('draft');
    expect((await publicCatalog()).catalog?.pictures).toEqual([]);

    const published = await api(`/api/admin/pictures/${picture.id}/publish`, { method: 'POST' });
    const body = await published.json() as { catalog: { status: string; version: number } };
    expect(body.catalog.status).toBe('succeeded');

    const { catalog, cacheControl } = await publicCatalog();
    expect(cacheControl).toMatch(/max-age=60/);
    expect(catalog?.version).toBe(body.catalog.version);
    expect(catalog?.pictures).toEqual([{
      id: picture.id, title: lake.title, theme: lake.theme, url: lake.url, thumbUrl: lake.thumbUrl,
      alt: lake.alt, attribution: lake.attribution, license: lake.license, minChallenge: 0, maxChallenge: 5,
    }]);
  });

  it('publishing clears this location\'s cached catalog', async () => {
    const picture = await createPicture();
    installCaches();
    await send(new Request(`${SITE}/catalog.json`)); // cache the empty catalog
    await api(`/api/admin/pictures/${picture.id}/publish`, { method: 'POST' });
    const response = await send(new Request(`${SITE}/catalog.json`));
    expect(parseCatalog(await response.json())?.pictures).toHaveLength(1);
  });

  it('cached copies expire within a minute, with no stale-while-revalidate', async () => {
    const response = await send(new Request(`${SITE}/catalog.json`));
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('edits to a published picture, reorder and unpublish all reach the catalog', async () => {
    const a = await createPicture();
    const b = await createPicture({ ...lake, title: 'Forest', url: `https://${IMAGE_HOST}/pics/forest-v1.png`, thumbUrl: undefined });
    await api(`/api/admin/pictures/${a.id}/publish`, { method: 'POST' });
    await api(`/api/admin/pictures/${b.id}/publish`, { method: 'POST' });

    const edited = await api(`/api/admin/pictures/${a.id}`, { method: 'PUT', body: { ...lake, title: 'Lake at Dawn', url: `https://${IMAGE_HOST}/pics/lake-v2.png` } });
    expect(edited.status).toBe(200);
    let { catalog } = await publicCatalog();
    expect(catalog?.pictures.map((p) => p.title)).toEqual(['Lake at Dawn', 'Forest']);
    expect(catalog?.pictures[0].url).toBe(`https://${IMAGE_HOST}/pics/lake-v2.png`);

    expect((await api('/api/admin/reorder', { method: 'POST', body: { ids: [b.id, a.id] } })).status).toBe(200);
    ({ catalog } = await publicCatalog());
    expect(catalog?.pictures.map((p) => p.id)).toEqual([b.id, a.id]);

    await api(`/api/admin/pictures/${b.id}/unpublish`, { method: 'POST' });
    ({ catalog } = await publicCatalog());
    expect(catalog?.pictures.map((p) => p.id)).toEqual([a.id]);
  });

  it('a database outage returns 503 so the game uses its fallback pictures', async () => {
    store.failNext = true;
    installCaches();
    expect((await send(new Request(`${SITE}/catalog.json`))).status).toBe(503);
  });

  it('records an audit trail', async () => {
    const picture = await createPicture();
    await api(`/api/admin/pictures/${picture.id}/publish`, { method: 'POST' });
    expect(store.auditLog.map(({ actor, action }) => ({ actor, action }))).toEqual([
      { actor: 'admin@example.com', action: 'create' },
      { actor: 'admin@example.com', action: 'publish' },
    ]);
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
    ['an IP address', 'https://203.0.113.5/a.png', {}, /public website name/],
    ['localhost', 'https://localhost/a.png', {}, /public website name/],
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

  it('allows any https website when no image hosts are configured', async () => {
    env = createEnv({ IMAGE_HOSTS: '' });
    const url = 'https://cdn.somewhere.example/photos/lake.png';
    images.set(url, {});
    expect((await check(url)).ok).toBe(true);
    expect((await check('https://192.168.1.10/a.png')).image.errors.join(' ')).toMatch(/public website name/);
  });

  it('accepts r2.dev links with a warning', async () => {
    env = createEnv({ IMAGE_HOSTS: '' });
    const url = 'https://pub-123.r2.dev/a.png';
    images.set(url, {});
    const result = await check(url);
    expect(result.ok).toBe(true);
    expect(result.image.warnings.join(' ')).toMatch(/r2.dev/);
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
    const response = await send(new Request(`${SITE}/api/admin/pictures`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: SITE, cookie },
      body: JSON.stringify(lake),
    }));
    expect(response.status).toBe(400);
  });

  it('re-checks the image at publish time', async () => {
    const picture = await createPicture();
    images.set(lake.url, { cors: null });
    const response = await api(`/api/admin/pictures/${picture.id}/publish`, { method: 'POST' });
    expect(response.status).toBe(422);
    expect(store.pictures[0].status).toBe('draft');
    expect(store.publications).toHaveLength(0);
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
    expect(await (await send(new Request(`${SITE}/`))).text()).toBe('asset:/');
    expect((await send(new Request(`${SITE}/api/nope`))).status).toBe(404);
    expect(ORIGIN).toBe(SITE);
  });
});
