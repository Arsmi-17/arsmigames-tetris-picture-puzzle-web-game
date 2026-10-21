/**
 * Runs the admin API and catalog against a real PostgREST + Postgres with
 * the Supabase migration applied (the same API Supabase serves).
 *
 *   SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_SERVICE_KEY=... \
 *   SUPABASE_TEST_ANON_KEY=... npx vitest run tests/worker/supabase.integration.test.ts
 *
 * Skipped when those variables are not set.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../worker/src/index';
import { resetLoginAttempts } from '../../worker/src/session';
import { createSupabaseStore, TABLES } from '../../worker/src/supabase';
import { DuplicateError } from '../../worker/src/store';
import { parseCatalog } from '../../shared/catalog';
import { ADMIN_EMAIL, ADMIN_KEY, IMAGE_HOST, createEnv, ctx, installCaches, pngHeader } from './fakes';

const BASE = process.env.SUPABASE_TEST_URL;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY ?? '';
const ANON = process.env.SUPABASE_TEST_ANON_KEY ?? '';
const SITE = 'https://play.example.com';
const realFetch = globalThis.fetch;
const run = `${Date.now().toString(36)}`;

describe.skipIf(!BASE)('Supabase (PostgREST) integration', () => {
  const env = createEnv({ SUPABASE_URL: BASE!, SUPABASE_SERVICE_ROLE_KEY: SERVICE });
  let cookie = '';

  beforeAll(async () => {
    resetLoginAttempts();
    installCaches();
    // Supabase serves PostgREST under /rest/v1; plain PostgREST serves it at the root.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith(BASE!)) return realFetch(url.replace('/rest/v1/', '/'), init);
      if (url.startsWith(`https://${IMAGE_HOST}/`)) {
        return new Response(pngHeader(1200, 1200), {
          headers: { 'content-type': 'image/png', 'content-length': '400000', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable' },
        });
      }
      return new Response('missing', { status: 404 });
    });
    const login = await handleRequest(new Request(`${SITE}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: JSON.stringify({ email: ADMIN_EMAIL, key: ADMIN_KEY }),
    }), env, ctx);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const api = (path: string, method = 'GET', body?: unknown) => handleRequest(new Request(`${SITE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie, origin: SITE },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, ctx);

  const picture = (n: string) => ({
    title: `Lake ${n}`, theme: 'Calm', url: `https://${IMAGE_HOST}/pics/${run}-${n}.png`,
    alt: 'A lake.', attribution: 'Photo by A', license: 'CC BY 4.0', minChallenge: 1, maxChallenge: 6,
  });

  it('creates, publishes, edits, reorders and unpublishes through Supabase', async () => {
    const a = await (await api('/api/admin/pictures', 'POST', picture('a'))).json() as { picture: { id: string; status: string; width: number } };
    const b = await (await api('/api/admin/pictures', 'POST', picture('b'))).json() as { picture: { id: string } };
    expect(a.picture.status).toBe('draft');
    expect(a.picture.width).toBe(1200);

    const pub = await (await api(`/api/admin/pictures/${a.picture.id}/publish`, 'POST')).json() as { catalog: { version: number } };
    await api(`/api/admin/pictures/${b.picture.id}/publish`, 'POST');
    expect(pub.catalog.version).toBeGreaterThan(0);

    const edited = await api(`/api/admin/pictures/${a.picture.id}`, 'PUT', { ...picture('a'), title: 'Lake at dawn' });
    expect(edited.status).toBe(200);

    const list = await (await api('/api/admin/pictures')).json() as { pictures: { id: string }[] };
    const ids = list.pictures.map((p) => p.id);
    const reordered = [b.picture.id, a.picture.id, ...ids.filter((id) => id !== a.picture.id && id !== b.picture.id)];
    expect((await api('/api/admin/reorder', 'POST', { ids: reordered })).status).toBe(200);

    installCaches();
    const catalog = parseCatalog(await (await handleRequest(new Request(`${SITE}/catalog.json`), env, ctx)).json());
    const mine = catalog!.pictures.filter((p) => p.id === a.picture.id || p.id === b.picture.id);
    expect(mine.map((p) => p.id)).toEqual([b.picture.id, a.picture.id]);
    expect(mine[1].title).toBe('Lake at dawn');

    await api(`/api/admin/pictures/${b.picture.id}/unpublish`, 'POST');
    installCaches();
    const after = parseCatalog(await (await handleRequest(new Request(`${SITE}/catalog.json`), env, ctx)).json());
    expect(after!.pictures.some((p) => p.id === b.picture.id)).toBe(false);
  });

  it('maps a duplicate URL to a clear error', async () => {
    const store = createSupabaseStore(env);
    const row = {
      id: `dup-${run}`, title: 'Dup', theme: 'T', url: `https://${IMAGE_HOST}/pics/${run}-dup.png`, thumb_url: null, alt: 'x',
      attribution: null, license: null, min_challenge: 0, max_challenge: 7, status: 'draft' as const, sort_order: 0,
      width: null, height: null, bytes: null, content_type: null, updated_by: 'test',
    };
    await store.insertPicture(row);
    await expect(store.insertPicture({ ...row, id: `dup2-${run}` })).rejects.toBeInstanceOf(DuplicateError);
  });

  it('players (anon key) see only published pictures and only public columns', async () => {
    const headers = { apikey: ANON, authorization: `Bearer ${ANON}` };
    const table = encodeURIComponent(TABLES.pictures);
    const visible = await (await realFetch(`${BASE}/${table}?select=id,title,url`, { headers })).json() as { id: string }[];
    const all = await createSupabaseStore(env).listPictures();
    expect(visible.length).toBe(all.filter((p) => p.status === 'published').length);
    expect((await realFetch(`${BASE}/${table}?select=updated_by`, { headers })).status).toBe(401);
    const write = await realFetch(`${BASE}/${table}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'x', title: 'x' }) });
    expect(write.ok).toBe(false);
    expect((await realFetch(`${BASE}/${encodeURIComponent(TABLES.audit)}?select=*`, { headers })).ok).toBe(false);
  });
});
