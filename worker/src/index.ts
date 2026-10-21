import type { Env } from './env';
import { verifyAdmin } from './access';
import { handleAdminApi } from './admin';
import { CATALOG_CACHE_CONTROL, CATALOG_KEY } from './catalog';
import { handleEvents } from './events';
import { error, withHeaders } from './http';

/**
 * One Worker serves the whole site:
 *   /catalog.json      public catalog, edge cached
 *   /api/events        anonymous gameplay events
 *   /api/admin/*       catalog management (Cloudflare Access + JWT check)
 *   /admin/            admin UI assets (same protection)
 *   everything else    the game's static assets
 */

const ADMIN_PAGE_HEADERS = {
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
};

async function serveCatalog(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(new URL('/catalog.json', request.url).toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const object = await env.CATALOG_BUCKET.get(CATALOG_KEY);
  if (!object) return error(404, 'No catalog has been published yet.');
  const response = new Response(object.body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': CATALOG_CACHE_CONTROL,
      etag: object.httpEtag,
      'x-content-type-options': 'nosniff',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/catalog.json') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed.');
    return serveCatalog(request, env, ctx);
  }

  if (path === '/api/events') return handleEvents(request, env);

  if (path.startsWith('/api/admin/') || path === '/admin' || path.startsWith('/admin/')) {
    const admin = await verifyAdmin(request, env);
    if (!admin) {
      return path.startsWith('/api/')
        ? error(401, 'Sign in through Cloudflare Access to manage pictures.')
        : new Response('Sign in through Cloudflare Access to open the admin page.', { status: 401, headers: ADMIN_PAGE_HEADERS });
    }
    if (path.startsWith('/api/admin/')) {
      try {
        return await handleAdminApi(request, env, admin, path);
      } catch (cause) {
        console.error('admin api error', cause);
        return error(500, 'The admin request failed. Try again.');
      }
    }
    if (path === '/admin') return Response.redirect(new URL('/admin/', url).toString(), 301);
    return withHeaders(await env.ASSETS.fetch(request), ADMIN_PAGE_HEADERS);
  }

  if (path.startsWith('/api/')) return error(404, 'Not found.');
  return env.ASSETS.fetch(request);
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
