import { CATALOG_MAX_CHALLENGE, PICTURE_ID_PATTERN } from '../../shared/catalog';
import type { Env } from './env';
import type { AdminIdentity } from './access';
import { checkImage, parseHosts, MAX_IMAGE_BYTES, MAX_THUMB_BYTES, type ImageCheck } from './images';
import {
  audit,
  catalogStatus,
  findByUrl,
  getPicture,
  listPictures,
  publishCatalog,
  type PictureRow,
  type PublishOutcome,
} from './catalog';
import { error, json, readJson } from './http';

const MAX_BODY_BYTES = 16 * 1024;

interface PictureInput {
  title: string;
  theme: string;
  url: string;
  thumbUrl: string | null;
  alt: string;
  attribution: string | null;
  license: string | null;
  minChallenge: number;
  maxChallenge: number;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function field(body: Record<string, unknown>, name: string, max: number, required: boolean, errors: string[]): string | null {
  const value = body[name];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (required) errors.push(`${name} is required.`);
    return null;
  }
  if (typeof value !== 'string') {
    errors.push(`${name} must be text.`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > max) errors.push(`${name} must be at most ${max} characters.`);
  return trimmed;
}

export function parsePictureInput(raw: unknown): Parsed<PictureInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Send the picture details as JSON.'] };
  const body = raw as Record<string, unknown>;
  const errors: string[] = [];
  const title = field(body, 'title', 80, true, errors);
  const theme = field(body, 'theme', 40, true, errors);
  const url = field(body, 'url', 2048, true, errors);
  const thumbUrl = field(body, 'thumbUrl', 2048, false, errors);
  const alt = field(body, 'alt', 300, true, errors);
  const attribution = field(body, 'attribution', 200, false, errors);
  const license = field(body, 'license', 80, false, errors);
  const level = (name: string) => {
    const value = body[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > CATALOG_MAX_CHALLENGE) {
      errors.push(`${name} must be a whole number from 0 to ${CATALOG_MAX_CHALLENGE}.`);
      return 0;
    }
    return value;
  };
  const minChallenge = level('minChallenge');
  const maxChallenge = level('maxChallenge');
  if (minChallenge > maxChallenge) errors.push('minChallenge must not be above maxChallenge.');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { title: title!, theme: theme!, url: url!, thumbUrl, alt: alt!, attribution, license, minChallenge, maxChallenge } };
}

function slug(title: string): string {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'picture';
  const suffix = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5);
  return `${base}-${suffix}`;
}

interface ImageReport {
  image: ImageCheck;
  thumb?: ImageCheck;
  duplicateOf?: string;
}

async function checkPictureImages(env: Env, url: string, thumbUrl: string | null, selfId?: string): Promise<ImageReport> {
  const hosts = parseHosts(env.IMAGE_HOSTS);
  const [image, thumb] = await Promise.all([
    checkImage(url, { allowedHosts: hosts, gameOrigin: env.GAME_ORIGIN, maxBytes: MAX_IMAGE_BYTES }),
    thumbUrl ? checkImage(thumbUrl, { allowedHosts: hosts, gameOrigin: env.GAME_ORIGIN, maxBytes: MAX_THUMB_BYTES, thumbnail: true }) : Promise.resolve(undefined),
  ]);
  const report: ImageReport = { image, thumb };
  const existing = await findByUrl(env, url);
  if (existing && existing.id !== selfId) {
    report.duplicateOf = existing.id;
    image.errors.push(`This image is already in the catalog as "${existing.title}".`);
    image.ok = false;
  }
  return report;
}

function reportOk(report: ImageReport): boolean {
  return report.image.ok && (report.thumb?.ok ?? true);
}

/**
 * Admin API. The caller has already verified the Access identity; this layer
 * adds CSRF protection for writes, input validation and auditing.
 */
export async function handleAdminApi(request: Request, env: Env, admin: AdminIdentity, path: string): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET') {
    // Access authenticates with a cookie, so refuse cross-site writes.
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return error(403, 'Cross-origin admin requests are not allowed.');
  }

  if (method === 'GET' && path === '/api/admin/me') return json({ email: admin.email });

  if (method === 'GET' && path === '/api/admin/pictures') {
    const [pictures, status] = await Promise.all([listPictures(env), catalogStatus(env)]);
    return json({ pictures, status });
  }

  if (method === 'GET' && path === '/api/admin/status') return json(await catalogStatus(env));

  if (method === 'POST' && path === '/api/admin/check-image') {
    const body = (await readJson(request, MAX_BODY_BYTES)) as Record<string, unknown> | undefined;
    if (!body || typeof body.url !== 'string') return error(400, 'Send { url } as JSON.');
    const thumbUrl = typeof body.thumbUrl === 'string' && body.thumbUrl.trim() ? body.thumbUrl.trim() : null;
    const selfId = typeof body.id === 'string' ? body.id : undefined;
    const report = await checkPictureImages(env, body.url.trim(), thumbUrl, selfId);
    return json({ ok: reportOk(report), ...report });
  }

  if (method === 'POST' && path === '/api/admin/publish') {
    const catalog = await publishCatalog(env, admin.email);
    await audit(env, admin.email, 'republish', null, catalog);
    return json({ catalog }, catalog.status === 'succeeded' ? 200 : 502);
  }

  if (method === 'POST' && path === '/api/admin/reorder') {
    const body = (await readJson(request, MAX_BODY_BYTES)) as { ids?: unknown } | undefined;
    const ids = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !ids.every((id) => typeof id === 'string')) {
      return error(400, 'Send { ids: [...] } with every picture id in the new order.');
    }
    const existing = await listPictures(env);
    const known = new Set(existing.map((p) => p.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
      return error(409, 'The picture list changed; reload and try again.');
    }
    const now = new Date().toISOString();
    await env.DB.batch(ids.map((id, index) =>
      env.DB.prepare('UPDATE pictures SET sort_order = ?, updated_at = CASE WHEN sort_order != ? THEN ? ELSE updated_at END, updated_by = ? WHERE id = ?')
        .bind(index, index, now, admin.email, id),
    ));
    await audit(env, admin.email, 'reorder', null, { count: ids.length });
    const catalog = existing.some((p) => p.status === 'published') ? await publishCatalog(env, admin.email) : undefined;
    return json({ pictures: await listPictures(env), catalog });
  }

  if (method === 'POST' && path === '/api/admin/pictures') {
    const parsed = parsePictureInput(await readJson(request, MAX_BODY_BYTES));
    if (!parsed.ok) return error(400, 'Some details need fixing.', { errors: parsed.errors });
    const input = parsed.value;
    const report = await checkPictureImages(env, input.url, input.thumbUrl);
    if (!reportOk(report)) return error(422, 'The image did not pass the checks.', { report });

    const id = slug(input.title);
    const now = new Date().toISOString();
    const order = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM pictures').first<{ next: number }>();
    await env.DB.prepare(
      `INSERT INTO pictures (id, title, theme, url, thumb_url, alt, attribution, license, min_challenge, max_challenge,
        status, sort_order, width, height, bytes, content_type, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, input.title, input.theme, input.url, input.thumbUrl, input.alt, input.attribution, input.license,
      input.minChallenge, input.maxChallenge, order?.next ?? 0,
      report.image.width ?? null, report.image.height ?? null, report.image.bytes ?? null, report.image.contentType ?? null,
      now, now, admin.email,
    ).run();
    await audit(env, admin.email, 'create', id, { title: input.title });
    return json({ picture: await getPicture(env, id), report }, 201);
  }

  const match = path.match(/^\/api\/admin\/pictures\/([^/]+)(?:\/(publish|unpublish))?$/);
  if (match && PICTURE_ID_PATTERN.test(match[1])) {
    const id = match[1];
    const action = match[2];
    const current = await getPicture(env, id);
    if (!current) return error(404, 'Picture not found.');

    if (method === 'GET' && !action) return json({ picture: current });

    if (method === 'POST' && action) {
      const status = action === 'publish' ? 'published' : 'unpublished';
      if (action === 'publish') {
        // Re-check at publish time: the file or bucket CORS may have changed.
        const report = await checkPictureImages(env, current.url, current.thumb_url, id);
        if (!reportOk(report)) return error(422, 'The image no longer passes the checks.', { report });
      }
      await env.DB.prepare('UPDATE pictures SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .bind(status, new Date().toISOString(), admin.email, id).run();
      await audit(env, admin.email, action, id);
      const catalog = await publishCatalog(env, admin.email);
      return json({ picture: await getPicture(env, id), catalog });
    }

    if (method === 'PUT' && !action) {
      const parsed = parsePictureInput(await readJson(request, MAX_BODY_BYTES));
      if (!parsed.ok) return error(400, 'Some details need fixing.', { errors: parsed.errors });
      const input = parsed.value;
      let report: ImageReport | undefined;
      if (input.url !== current.url || input.thumbUrl !== current.thumb_url) {
        report = await checkPictureImages(env, input.url, input.thumbUrl, id);
        if (!reportOk(report)) return error(422, 'The image did not pass the checks.', { report });
      }
      await env.DB.prepare(
        `UPDATE pictures SET title = ?, theme = ?, url = ?, thumb_url = ?, alt = ?, attribution = ?, license = ?,
          min_challenge = ?, max_challenge = ?, width = COALESCE(?, width), height = COALESCE(?, height),
          bytes = COALESCE(?, bytes), content_type = COALESCE(?, content_type), updated_at = ?, updated_by = ?
         WHERE id = ?`,
      ).bind(
        input.title, input.theme, input.url, input.thumbUrl, input.alt, input.attribution, input.license,
        input.minChallenge, input.maxChallenge,
        report?.image.width ?? null, report?.image.height ?? null, report?.image.bytes ?? null, report?.image.contentType ?? null,
        new Date().toISOString(), admin.email, id,
      ).run();
      await audit(env, admin.email, 'edit', id);
      let catalog: PublishOutcome | undefined;
      if (current.status === 'published') catalog = await publishCatalog(env, admin.email);
      return json({ picture: await getPicture(env, id), report, catalog });
    }
  }

  return error(404, 'Not found.');
}

export type { PictureRow };
