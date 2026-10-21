import type { Env } from './env';
import {
  DuplicateError,
  type CatalogStore,
  type NewPictureRow,
  type PicturePatch,
  type PictureRow,
  type PublicationRow,
} from './store';

/** Table names from supabase/migrations. */
export const TABLES = {
  pictures: 'mg-tetris-reveal-game',
  publications: 'mg-tetris-reveal-game_publications',
  audit: 'mg-tetris-reveal-game_audit_log',
} as const;

const TIMEOUT_MS = 10000;

export class SupabaseError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/**
 * Catalog store over Supabase's REST API (PostgREST), using the service_role
 * key. The key never leaves the server.
 */
export function createSupabaseStore(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>): CatalogStore {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new SupabaseError('Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).', 500);
  }
  const base = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  async function request<T>(table: string, query: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
    const response = await fetch(`${base}/${encodeURIComponent(table)}${query}`, {
      method: init.method ?? 'GET',
      headers: init.prefer ? { ...headers, prefer: init.prefer } : headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      let detail: { message?: string; code?: string } = {};
      try {
        detail = JSON.parse(text);
      } catch {
        // Non-JSON error body.
      }
      if (detail.code === '23505') throw new DuplicateError(detail.message ?? 'Duplicate value.');
      throw new SupabaseError(`Supabase ${response.status}: ${detail.message ?? text.slice(0, 200)}`, response.status, detail.code);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  const eq = (value: string) => `eq.${encodeURIComponent(value)}`;
  const order = 'order=sort_order.asc,created_at.asc';

  return {
    listPictures: () => request<PictureRow[]>(TABLES.pictures, `?select=*&${order}`),
    publishedPictures: () => request<PictureRow[]>(TABLES.pictures, `?select=*&status=eq.published&${order}`),
    async getPicture(id) {
      const rows = await request<PictureRow[]>(TABLES.pictures, `?select=*&id=${eq(id)}&limit=1`);
      return rows[0] ?? null;
    },
    async findByUrl(url) {
      const rows = await request<PictureRow[]>(TABLES.pictures, `?select=*&url=${eq(url)}&limit=1`);
      return rows[0] ?? null;
    },
    async insertPicture(row: NewPictureRow) {
      const rows = await request<PictureRow[]>(TABLES.pictures, '', { method: 'POST', body: row, prefer: 'return=representation' });
      return rows[0];
    },
    async updatePicture(id: string, patch: PicturePatch) {
      const rows = await request<PictureRow[]>(TABLES.pictures, `?id=${eq(id)}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
      return rows[0] ?? null;
    },
    async recordPublication(actor, pictureCount) {
      const now = new Date().toISOString();
      const rows = await request<PublicationRow[]>(TABLES.publications, '', {
        method: 'POST',
        body: { status: 'succeeded', picture_count: pictureCount, started_at: now, finished_at: now, published_by: actor },
        prefer: 'return=representation',
      });
      return rows[0];
    },
    async latestPublication() {
      const rows = await request<PublicationRow[]>(TABLES.publications, '?select=*&status=eq.succeeded&order=version.desc&limit=1');
      return rows[0] ?? null;
    },
    async audit(actor, action, pictureId, detail) {
      await request(TABLES.audit, '', {
        method: 'POST',
        body: { actor, action, picture_id: pictureId, detail: detail === undefined ? null : detail },
        prefer: 'return=minimal',
      });
    },
  };
}
