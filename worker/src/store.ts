/** Rows as stored in Supabase (see supabase/migrations). */

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

export type NewPictureRow = Omit<PictureRow, 'created_at' | 'updated_at'>;
export type PicturePatch = Partial<Omit<PictureRow, 'id' | 'created_at' | 'updated_at'>>;

export interface PublicationRow {
  version: number;
  status: 'pending' | 'succeeded' | 'failed';
  picture_count: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  published_by: string;
}

/** Raised when a picture URL or id already exists. */
export class DuplicateError extends Error {}

/** Everything the admin API and catalog need from the database. */
export interface CatalogStore {
  listPictures(): Promise<PictureRow[]>;
  /** Published pictures in display order. */
  publishedPictures(): Promise<PictureRow[]>;
  getPicture(id: string): Promise<PictureRow | null>;
  findByUrl(url: string): Promise<PictureRow | null>;
  insertPicture(row: NewPictureRow): Promise<PictureRow>;
  updatePicture(id: string, patch: PicturePatch): Promise<PictureRow | null>;
  /** Record a catalog publication and return its version. */
  recordPublication(actor: string, pictureCount: number): Promise<PublicationRow>;
  latestPublication(): Promise<PublicationRow | null>;
  audit(actor: string, action: string, pictureId: string | null, detail?: unknown): Promise<void>;
}
