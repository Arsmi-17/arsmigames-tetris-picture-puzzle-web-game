/**
 * Public catalog format, shared by the game (reader) and the Worker (writer).
 * Keep it compact: the game downloads it on every visit.
 */

export const CATALOG_SCHEMA = 1;
/** Highest challenge ladder level; mirrors src/challenge.ts. */
export const CATALOG_MAX_CHALLENGE = 7;

export interface CatalogPicture {
  id: string;
  title: string;
  theme: string;
  url: string;
  thumbUrl?: string;
  alt: string;
  attribution?: string;
  license?: string;
  minChallenge: number;
  maxChallenge: number;
}

export interface PublicCatalog {
  schema: typeof CATALOG_SCHEMA;
  /** Increments on every successful publication. */
  version: number;
  generatedAt: string;
  pictures: CatalogPicture[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  const raw = text(value, 2048);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function level(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= CATALOG_MAX_CHALLENGE ? value : undefined;
}

/** Validate one entry from an untrusted catalog. Returns null if unusable. */
export function parseCatalogPicture(raw: unknown): CatalogPicture | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const id = text(entry.id, 64);
  const title = text(entry.title, 80);
  const theme = text(entry.theme, 40);
  const url = httpsUrl(entry.url);
  const alt = text(entry.alt, 300);
  const minChallenge = level(entry.minChallenge);
  const maxChallenge = level(entry.maxChallenge);
  if (!id || !ID_PATTERN.test(id) || !title || !theme || !url || !alt || minChallenge === undefined || maxChallenge === undefined || minChallenge > maxChallenge) {
    return null;
  }
  const picture: CatalogPicture = { id, title, theme, url, alt, minChallenge, maxChallenge };
  const thumbUrl = httpsUrl(entry.thumbUrl);
  const attribution = text(entry.attribution, 200);
  const license = text(entry.license, 80);
  if (thumbUrl) picture.thumbUrl = thumbUrl;
  if (attribution) picture.attribution = attribution;
  if (license) picture.license = license;
  return picture;
}

/** Validate a whole catalog, dropping bad entries rather than failing. */
export function parseCatalog(raw: unknown): PublicCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (data.schema !== CATALOG_SCHEMA || typeof data.version !== 'number' || !Array.isArray(data.pictures)) return null;
  const seen = new Set<string>();
  const pictures: CatalogPicture[] = [];
  for (const item of data.pictures) {
    const picture = parseCatalogPicture(item);
    if (picture && !seen.has(picture.id)) {
      seen.add(picture.id);
      pictures.push(picture);
    }
  }
  return {
    schema: CATALOG_SCHEMA,
    version: data.version,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : '',
    pictures,
  };
}

export { ID_PATTERN as PICTURE_ID_PATTERN };
