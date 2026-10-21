import type { Env } from './env';
import { handleAdminApi } from './admin';
import { CATALOG_PATH, serveCatalog } from './catalog';
import { handleEvents } from './events';
import { error, json, readJson, withHeaders } from './http';
import { checkCredentials, clearSessionCookie, createSessionCookie, loginBlocked, verifySession } from './session';
import type { CatalogStore } from './store';
import { createSupabaseStore } from './supabase';

/**
 * Pages advanced-mode worker. Every request comes here first:
 *   /catalog.json        public catalog from Supabase, edge cached
 *   /api/events          anonymous gameplay events
 *   /api/admin/login     admin sign-in (ADMIN_EMAIL + ADMIN_KEY)
 *   /api/admin/*         catalog management (signed session cookie)
 *   /admin/              admin page (shows a sign-in form until signed in)
 *   everything else      the game's static files
 */

const ADMIN_PAGE_HEADERS = {
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
};

export interface Deps {
  store?: CatalogStore;
}

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext, deps: Deps = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const store = () => deps.store ?? createSupabaseStore(env);

  if (path === CATALOG_PATH) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed.');
    try {
      return await serveCatalog(request.url, store(), ctx);
    } catch (cause) {
      console.error('catalog error', cause);
      // The game falls back to its cached or built-in pictures.
      return error(503, 'The picture catalog is temporarily unavailable.');
    }
  }

  if (path === '/api/events') return handleEvents(request, env);

  if (path === '/api/admin/login') {
    if (request.method !== 'POST') return error(405, 'Method not allowed.');
    const origin = request.headers.get('origin');
    if (!origin || origin !== url.origin) return error(403, 'Cross-origin sign-in is not allowed.');
    if (loginBlocked(request)) return error(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const body = (await readJson(request, 2048)) as { email?: unknown; key?: unknown } | undefined;
    const admin = await checkCredentials(request, env, body?.email, body?.key);
    if (!admin) return error(401, 'That email and key do not match.');
    return json({ email: admin.email }, 200, { 'set-cookie': await createSessionCookie(env, admin) });
  }

  if (path === '/api/admin/logout') {
    if (request.method !== 'POST') return error(405, 'Method not allowed.');
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }

  if (path.startsWith('/api/admin/')) {
    const admin = await verifySession(request, env);
    if (!admin) return error(401, 'Sign in to manage pictures.');
    try {
      return await handleAdminApi(request, env, store(), admin, path);
    } catch (cause) {
      console.error('admin api error', cause);
      return error(500, 'The admin request failed. Try again.');
    }
  }

  if (path === '/admin') return Response.redirect(new URL('/admin/', url).toString(), 301);
  if (path.startsWith('/admin/')) return withHeaders(await env.ASSETS.fetch(request), ADMIN_PAGE_HEADERS);

  if (path.startsWith('/api/')) return error(404, 'Not found.');
  return env.ASSETS.fetch(request);
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => handleRequest(request, env, ctx),
} satisfies ExportedHandler<Env>;
