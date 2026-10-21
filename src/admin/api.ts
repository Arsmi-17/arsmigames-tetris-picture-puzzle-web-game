/** Types and fetch helpers for the admin API (worker/src/admin.ts). */

export type PictureStatus = 'draft' | 'published' | 'unpublished';

export interface AdminPicture {
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
  updated_at: string;
  updated_by: string;
}

export interface Publication {
  version: number;
  status: 'pending' | 'succeeded' | 'failed';
  picture_count: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface CatalogStatus {
  /** The most recent change to what players see. */
  latest: Publication | null;
}

export interface ImageCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  width?: number;
  height?: number;
  bytes?: number;
  contentType?: string;
}

export interface ImageReport {
  ok?: boolean;
  image: ImageCheck;
  thumb?: ImageCheck;
}

export interface PublishOutcome {
  status: 'succeeded';
  version: number;
  pictureCount: number;
}

export interface PictureForm {
  title: string;
  theme: string;
  url: string;
  thumbUrl: string;
  alt: string;
  attribution: string;
  license: string;
  minChallenge: number;
  maxChallenge: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    // Non-JSON error page (for example a platform error).
  }
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : `Request failed (HTTP ${response.status}).`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}

export function toForm(picture?: AdminPicture): PictureForm {
  return {
    title: picture?.title ?? '',
    theme: picture?.theme ?? '',
    url: picture?.url ?? '',
    thumbUrl: picture?.thumb_url ?? '',
    alt: picture?.alt ?? '',
    attribution: picture?.attribution ?? '',
    license: picture?.license ?? '',
    minChallenge: picture?.min_challenge ?? 0,
    maxChallenge: picture?.max_challenge ?? 7,
  };
}

export function toPayload(form: PictureForm) {
  const optional = (value: string) => (value.trim() ? value.trim() : null);
  return {
    title: form.title.trim(),
    theme: form.theme.trim(),
    url: form.url.trim(),
    thumbUrl: optional(form.thumbUrl),
    alt: form.alt.trim(),
    attribution: optional(form.attribution),
    license: optional(form.license),
    minChallenge: form.minChallenge,
    maxChallenge: form.maxChallenge,
  };
}
