import { CATALOG_MAX_CHALLENGE, PICTURE_ID_PATTERN } from '../../shared/catalog';
import type { Env } from './env';
import type { AdminIdentity } from './session';
import { checkImage, parseHosts, MAX_IMAGE_BYTES, MAX_THUMB_BYTES, type ImageCheck } from './images';
import { catalogStatus, publishCatalog, type PublishOutcome } from './catalog';
import { DuplicateError, type CatalogStore, type PictureRow } from './store';
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

async function checkPictureImages(env: Env, store: CatalogStore, url: string, thumbUrl: string | null, selfId?: string): Promise<ImageReport> {
  const hosts = parseHosts(env.IMAGE_HOSTS);
  const [image, thumb] = await Promise.all([
    checkImage(url, { allowedHosts: hosts, gameOrigin: env.GAME_ORIGIN, maxBytes: MAX_IMAGE_BYTES }),
    thumbUrl ? checkImage(thumbUrl, { allowedHosts: hosts, gameOrigin: env.GAME_ORIGIN, maxBytes: MAX_THUMB_BYTES, thumbnail: true }) : Promise.resolve(undefined),
  ]);
  const report: ImageReport = { image, thumb };
  const existing = await store.findByUrl(url);
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
 * Admin API. The caller has already verified the admin session; this layer
 * adds CSRF protection for writes, input validation and auditing.
 */
export async function handleAdminApi(request: Request, env: Env, store: CatalogStore, admin: AdminIdentity, path: string): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET') {
    // The session is a cookie, so refuse cross-site writes.
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return error(403, 'Cross-origin admin requests are not allowed.');
  }
  const publish = () => publishCatalog(store, admin.email, request.url);

  if (method === 'GET' && path === '/api/admin/me') return json({ email: admin.email });

  if (method === 'GET' && path === '/api/admin/pictures') {
    const [pictures, status] = await Promise.all([store.listPictures(), catalogStatus(store)]);
    return json({ pictures, status });
  }

  if (method === 'GET' && path === '/api/admin/status') return json(await catalogStatus(store));

  if (method === 'POST' && path === '/api/admin/check-image') {
    const body = (await readJson(request, MAX_BODY_BYTES)) as Record<string, unknown> | undefined;
    if (!body || typeof body.url !== 'string') return error(400, 'Send { url } as JSON.');
    const thumbUrl = typeof body.thumbUrl === 'string' && body.thumbUrl.trim() ? body.thumbUrl.trim() : null;
    const selfId = typeof body.id === 'string' ? body.id : undefined;
    const report = await checkPictureImages(env, store, body.url.trim(), thumbUrl, selfId);
    return json({ ok: reportOk(report), ...report });
  }

  if (method === 'POST' && path === '/api/admin/publish') {
    const catalog = await publish();
    await store.audit(admin.email, 'republish', null, catalog);
    return json({ catalog });
  }

  if (method === 'POST' && path === '/api/admin/reorder') {
    const body = (await readJson(request, MAX_BODY_BYTES)) as { ids?: unknown } | undefined;
    const ids = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !ids.every((id) => typeof id === 'string')) {
      return error(400, 'Send { ids: [...] } with every picture id in the new order.');
    }
    const existing = await store.listPictures();
    const byId = new Map(existing.map((p) => [p.id, p]));
    if (ids.length !== byId.size || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) {
      return error(409, 'The picture list changed; reload and try again.');
    }
    const changed = ids.map((id, index) => ({ id, index })).filter(({ id, index }) => byId.get(id)!.sort_order !== index);
    await Promise.all(changed.map(({ id, index }) => store.updatePicture(id, { sort_order: index, updated_by: admin.email })));
    await store.audit(admin.email, 'reorder', null, { count: changed.length });
    const touchesPublished = changed.some(({ id }) => byId.get(id)!.status === 'published');
    const catalog = touchesPublished ? await publish() : undefined;
    return json({ pictures: await store.listPictures(), catalog });
  }

  if (method === 'POST' && path === '/api/admin/pictures') {
    const parsed = parsePictureInput(await readJson(request, MAX_BODY_BYTES));
    if (!parsed.ok) return error(400, 'Some details need fixing.', { errors: parsed.errors });
    const input = parsed.value;
    const report = await checkPictureImages(env, store, input.url, input.thumbUrl);
    if (!reportOk(report)) return error(422, 'The image did not pass the checks.', { report });

    const existing = await store.listPictures();
    const nextOrder = existing.reduce((max, p) => Math.max(max, p.sort_order), -1) + 1;
    try {
      const picture = await store.insertPicture({
        id: slug(input.title),
        title: input.title,
        theme: input.theme,
        url: input.url,
        thumb_url: input.thumbUrl,
        alt: input.alt,
        attribution: input.attribution,
        license: input.license,
        min_challenge: input.minChallenge,
        max_challenge: input.maxChallenge,
        status: 'draft',
        sort_order: nextOrder,
        width: report.image.width ?? null,
        height: report.image.height ?? null,
        bytes: report.image.bytes ?? null,
        content_type: report.image.contentType ?? null,
        updated_by: admin.email,
      });
      await store.audit(admin.email, 'create', picture.id, { title: input.title });
      return json({ picture, report }, 201);
    } catch (cause) {
      if (cause instanceof DuplicateError) return error(409, 'This image is already in the catalog.');
      throw cause;
    }
  }

  const match = path.match(/^\/api\/admin\/pictures\/([^/]+)(?:\/(publish|unpublish))?$/);
  if (match && PICTURE_ID_PATTERN.test(match[1])) {
    const id = match[1];
    const action = match[2];
    const current = await store.getPicture(id);
    if (!current) return error(404, 'Picture not found.');

    if (method === 'GET' && !action) return json({ picture: current });

    if (method === 'POST' && action) {
      const status = action === 'publish' ? 'published' : 'unpublished';
      if (action === 'publish') {
        // Re-check at publish time: the file or its host may have changed.
        const report = await checkPictureImages(env, store, current.url, current.thumb_url, id);
        if (!reportOk(report)) return error(422, 'The image no longer passes the checks.', { report });
      }
      const picture = await store.updatePicture(id, { status, updated_by: admin.email });
      await store.audit(admin.email, action, id);
      const catalog = await publish();
      return json({ picture, catalog });
    }

    if (method === 'PUT' && !action) {
      const parsed = parsePictureInput(await readJson(request, MAX_BODY_BYTES));
      if (!parsed.ok) return error(400, 'Some details need fixing.', { errors: parsed.errors });
      const input = parsed.value;
      let report: ImageReport | undefined;
      if (input.url !== current.url || input.thumbUrl !== current.thumb_url) {
        report = await checkPictureImages(env, store, input.url, input.thumbUrl, id);
        if (!reportOk(report)) return error(422, 'The image did not pass the checks.', { report });
      }
      try {
        const picture = await store.updatePicture(id, {
          title: input.title,
          theme: input.theme,
          url: input.url,
          thumb_url: input.thumbUrl,
          alt: input.alt,
          attribution: input.attribution,
          license: input.license,
          min_challenge: input.minChallenge,
          max_challenge: input.maxChallenge,
          ...(report ? {
            width: report.image.width ?? current.width,
            height: report.image.height ?? current.height,
            bytes: report.image.bytes ?? current.bytes,
            content_type: report.image.contentType ?? current.content_type,
          } : {}),
          updated_by: admin.email,
        });
        await store.audit(admin.email, 'edit', id);
        let catalog: PublishOutcome | undefined;
        if (current.status === 'published') catalog = await publish();
        return json({ picture, report, catalog });
      } catch (cause) {
        if (cause instanceof DuplicateError) return error(409, 'This image is already in the catalog.');
        throw cause;
      }
    }
  }

  return error(404, 'Not found.');
}

export type { PictureRow };
