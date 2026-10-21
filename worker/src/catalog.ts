import { CATALOG_SCHEMA, type CatalogPicture, type PublicCatalog } from '../../shared/catalog';
import type { Env } from './env';

/** R2 key of the catalog the game reads. Versioned copies sit beside it. */
export const CATALOG_KEY = 'catalog/catalog.json';
export const CATALOG_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

export type PictureStatus = 'draft' | 'published' | 'unpublished';

export interface PictureRow {
  id: string;
  title: string;
  theme: string;
  url: string;
  thumb_url: string | null;
  alt: string;
  attribution: string | null;
  license: string | null;
  min_challenge: number;
  max_challenge: number;
  status: PictureStatus;
  sort_order: number;
  width: number | null;
  height: number | null;
  bytes: number | null;
  content_type: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export interface PublicationRow {
  version: number;
  status: 'pending' | 'succeeded' | 'failed';
  picture_count: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  published_by: string;
}

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

export async function listPictures(env: Env): Promise<PictureRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM pictures ORDER BY sort_order, created_at').all<PictureRow>();
  return results;
}

export async function getPicture(env: Env, id: string): Promise<PictureRow | null> {
  return env.DB.prepare('SELECT * FROM pictures WHERE id = ?').bind(id).first<PictureRow>();
}

export async function findByUrl(env: Env, url: string): Promise<PictureRow | null> {
  return env.DB.prepare('SELECT * FROM pictures WHERE url = ?').bind(url).first<PictureRow>();
}

export async function audit(env: Env, actor: string, action: string, pictureId: string | null, detail?: unknown): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (at, actor, action, picture_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(new Date().toISOString(), actor, action, pictureId, detail === undefined ? null : JSON.stringify(detail))
    .run();
}

export interface PublishOutcome {
  status: 'succeeded' | 'failed';
  version: number;
  pictureCount: number;
  error?: string;
}

/**
 * Write the public catalog from the published rows in D1. The D1 change that
 * triggered this is already committed; if the R2 write fails the attempt is
 * recorded as failed so the admin can see the catalog is stale and retry.
 */
export async function publishCatalog(env: Env, actor: string): Promise<PublishOutcome> {
  const startedAt = new Date().toISOString();
  const pending = await env.DB.prepare(
    "INSERT INTO catalog_publications (status, started_at, published_by) VALUES ('pending', ?, ?) RETURNING version",
  ).bind(startedAt, actor).first<{ version: number }>();
  if (!pending) throw new Error('Could not record the publication.');
  const version = pending.version;

  let pictureCount = 0;
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM pictures WHERE status = 'published' ORDER BY sort_order, created_at",
    ).all<PictureRow>();
    pictureCount = results.length;
    const catalog: PublicCatalog = {
      schema: CATALOG_SCHEMA,
      version,
      generatedAt: new Date().toISOString(),
      pictures: results.map(toCatalogPicture),
    };
    const body = JSON.stringify(catalog);
    const httpMetadata = { contentType: 'application/json; charset=utf-8', cacheControl: CATALOG_CACHE_CONTROL };
    await env.CATALOG_BUCKET.put(`catalog/v${version}.json`, body, { httpMetadata });
    await env.CATALOG_BUCKET.put(CATALOG_KEY, body, { httpMetadata, customMetadata: { version: String(version) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE catalog_publications SET status = 'failed', error = ?, finished_at = ?, picture_count = ? WHERE version = ?")
      .bind(message.slice(0, 500), new Date().toISOString(), pictureCount, version)
      .run();
    return { status: 'failed', version, pictureCount, error: message };
  }

  await env.DB.prepare("UPDATE catalog_publications SET status = 'succeeded', finished_at = ?, picture_count = ? WHERE version = ?")
    .bind(new Date().toISOString(), pictureCount, version)
    .run();
  return { status: 'succeeded', version, pictureCount };
}

export interface CatalogStatus {
  latest: PublicationRow | null;
  lastSuccess: PublicationRow | null;
  /** Published content changed after the last successful publication. */
  stale: boolean;
}

export async function catalogStatus(env: Env): Promise<CatalogStatus> {
  const latest = await env.DB.prepare('SELECT * FROM catalog_publications ORDER BY version DESC LIMIT 1').first<PublicationRow>();
  const lastSuccess = await env.DB.prepare(
    "SELECT * FROM catalog_publications WHERE status = 'succeeded' ORDER BY version DESC LIMIT 1",
  ).first<PublicationRow>();
  // Drafts never reach the public catalog, so their edits do not make it stale.
  const changed = await env.DB.prepare(
    "SELECT MAX(updated_at) AS at FROM pictures WHERE status != 'draft'",
  ).first<{ at: string | null }>();
  const stale =
    latest?.status === 'failed' ||
    (changed?.at != null && (!lastSuccess?.started_at || changed.at > lastSuccess.started_at));
  return { latest, lastSuccess, stale };
}
