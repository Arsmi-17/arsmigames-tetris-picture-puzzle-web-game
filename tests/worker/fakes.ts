import type { Env } from '../../worker/src/env';
import {
  DuplicateError,
  type CatalogStore,
  type NewPictureRow,
  type PicturePatch,
  type PictureRow,
  type PublicationRow,
} from '../../worker/src/store';

export interface MemoryStore extends CatalogStore {
  pictures: PictureRow[];
  publications: PublicationRow[];
  auditLog: { actor: string; action: string; picture_id: string | null }[];
  failNext: boolean;
}

/** In-memory store with the same rules as the Supabase tables (unique url, versions). */
export function createMemoryStore(): MemoryStore {
  let clock = Date.parse('2026-10-21T00:00:00Z');
  const now = () => new Date((clock += 1000)).toISOString();
  const sorted = (rows: PictureRow[]) => [...rows].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const store: MemoryStore = {
    pictures: [],
    publications: [],
    auditLog: [],
    failNext: false,
    async listPictures() {
      if (store.failNext) { store.failNext = false; throw new Error('Supabase unavailable'); }
      return sorted(store.pictures);
    },
    async publishedPictures() {
      if (store.failNext) { store.failNext = false; throw new Error('Supabase unavailable'); }
      return sorted(store.pictures.filter((p) => p.status === 'published'));
    },
    async getPicture(id) {
      return store.pictures.find((p) => p.id === id) ?? null;
    },
    async findByUrl(url) {
      return store.pictures.find((p) => p.url === url) ?? null;
    },
    async insertPicture(row: NewPictureRow) {
      if (store.pictures.some((p) => p.id === row.id || p.url === row.url)) throw new DuplicateError('duplicate');
      const at = now();
      const picture: PictureRow = { ...row, created_at: at, updated_at: at };
      store.pictures.push(picture);
      return picture;
    },
    async updatePicture(id, patch: PicturePatch) {
      const picture = store.pictures.find((p) => p.id === id);
      if (!picture) return null;
      if (patch.url && store.pictures.some((p) => p.id !== id && p.url === patch.url)) throw new DuplicateError('duplicate');
      Object.assign(picture, patch, { updated_at: now() });
      return picture;
    },
    async recordPublication(actor, pictureCount) {
      const at = now();
      const row: PublicationRow = { version: store.publications.length + 1, status: 'succeeded', picture_count: pictureCount, error: null, started_at: at, finished_at: at, published_by: actor };
      store.publications.push(row);
      return row;
    },
    async latestPublication() {
      return store.publications.at(-1) ?? null;
    },
    async audit(actor, action, pictureId) {
      store.auditLog.push({ actor, action, picture_id: pictureId });
    },
  };
  return store;
}

export function installCaches(): Map<string, Response> {
  const cache = new Map<string, Response>();
  (globalThis as unknown as { caches: unknown }).caches = {
    default: {
      match: async (req: Request) => cache.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { cache.set(req.url, res); },
      delete: async (req: Request) => cache.delete(req.url),
    },
  };
  return cache;
}

export const ctx = { waitUntil: (p: Promise<unknown>) => { void p; }, passThroughOnException() {} } as unknown as ExecutionContext;

export const ORIGIN = 'https://play.example.com';
export const IMAGE_HOST = 'images.example.com';
export const ADMIN_EMAIL = 'Admin@Example.com';
export const ADMIN_KEY = 'correct-horse-battery';

export function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`, { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    ADMIN_EMAIL,
    ADMIN_KEY,
    IMAGE_HOSTS: IMAGE_HOST,
    GAME_ORIGIN: ORIGIN,
    ...overrides,
  };
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
