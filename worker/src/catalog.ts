import { CATALOG_SCHEMA, type CatalogPicture, type PublicCatalog } from '../../shared/catalog';
import type { CatalogStore, PictureRow, PublicationRow } from './store';

export const CATALOG_PATH = '/catalog.json';
/** Every cached copy expires within a minute, so changes reach all players in that time. */
export const CATALOG_MAX_AGE_S = 60;
export const CATALOG_CACHE_CONTROL = `public, max-age=${CATALOG_MAX_AGE_S}`;

export function toCatalogPicture(row: PictureRow): CatalogPicture {
  const picture: CatalogPicture = {
    id: row.id,
    title: row.title,
    theme: row.theme,
    url: row.url,
    alt: row.alt,
    minChallenge: row.min_challenge,
    maxChallenge: row.max_challenge,
  };
  if (row.thumb_url) picture.thumbUrl = row.thumb_url;
  if (row.attribution) picture.attribution = row.attribution;
  if (row.license) picture.license = row.license;
  return picture;
}

/** Build the public catalog from the published rows. */
export async function buildCatalog(store: CatalogStore): Promise<PublicCatalog> {
  const [rows, latest] = await Promise.all([store.publishedPictures(), store.latestPublication()]);
  return {
    schema: CATALOG_SCHEMA,
    version: latest?.version ?? 0,
    generatedAt: new Date().toISOString(),
    pictures: rows.map(toCatalogPicture),
  };
}

/**
 * Cloudflare keeps a separate cache per hostname, so the key is the
 * hostname the request used. Publishing clears the admin's hostname at once;
 * copies for other hostnames (pages.dev, a custom domain) expire within
 * CATALOG_MAX_AGE_S.
 */
function cacheKey(requestUrl: string): Request {
  return new Request(new URL(CATALOG_PATH, requestUrl).toString(), { method: 'GET' });
}

function edgeCache(): Cache | null {
  return typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default;
}

/** Serve the catalog from the edge cache, rebuilding it from Supabase on a miss. */
export async function serveCatalog(requestUrl: string, store: CatalogStore, ctx: ExecutionContext): Promise<Response> {
  const cache = edgeCache();
  const key = cacheKey(requestUrl);
  const hit = await cache?.match(key);
  if (hit) return hit;

  const catalog = await buildCatalog(store);
  const response = new Response(JSON.stringify(catalog), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': CATALOG_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
    },
  });
  if (cache) ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

export interface PublishOutcome {
  status: 'succeeded';
  version: number;
  pictureCount: number;
}

/**
 * Record a new catalog version after a change to what players can see, and
 * drop the cached copy for the admin's hostname at this location. Every other
 * copy expires within CATALOG_MAX_AGE_S.
 */
export async function publishCatalog(store: CatalogStore, actor: string, requestUrl: string): Promise<PublishOutcome> {
  const published = await store.publishedPictures();
  const publication = await store.recordPublication(actor, published.length);
  await edgeCache()?.delete(cacheKey(requestUrl));
  return { status: 'succeeded', version: publication.version, pictureCount: published.length };
}

export interface CatalogStatus {
  latest: PublicationRow | null;
}

export async function catalogStatus(store: CatalogStore): Promise<CatalogStatus> {
  return { latest: await store.latestPublication() };
}
