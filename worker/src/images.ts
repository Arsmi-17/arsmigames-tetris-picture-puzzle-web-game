/**
 * Server-side checks for a pasted picture URL before it can be saved.
 * Errors block saving; warnings are shown to the admin but allowed.
 */

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;
export const MIN_IMAGE_SIDE = 512;
/** Larger than this is only a warning: phones will download it every round. */
export const LARGE_IMAGE_SIDE = 2400;
/** The board is square; anything further from 1:1 than this would distort. */
export const MAX_ASPECT_DEVIATION = 0.02;

const HEADER_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 10000;

export interface ImageCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  contentType?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

export interface ImageCheckOptions {
  allowedHosts: string[];
  gameOrigin: string;
  maxBytes: number;
  /** Thumbnails skip the size and squareness requirements. */
  thumbnail?: boolean;
}

export function parseHosts(value: string | undefined): string[] {
  return (value ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** Read width/height from the first bytes of a PNG, JPEG or WebP file. */
export function readDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: signature, then IHDR width/height at 16/20.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk segments to the first start-of-frame marker.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
    return null;
  }
  // WebP: RIFF....WEBP then VP8 / VP8L / VP8X chunk.
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = bytes.slice(21, 25);
      return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X') {
      const w = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
      const h = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
      return { width: w + 1, height: h + 1 };
    }
  }
  return null;
}

async function readHead(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.slice(0, out.length - offset);
    out.set(slice, offset);
    offset += slice.length;
    if (offset >= out.length) break;
  }
  return out;
}

export async function checkImage(rawUrl: string, options: ImageCheckOptions): Promise<ImageCheck> {
  const result: ImageCheck = { ok: false, errors: [], warnings: [] };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    result.errors.push('Enter a complete image URL starting with https://.');
    return result;
  }
  if (url.protocol !== 'https:') result.errors.push('Image URLs must use https://.');
  if (url.username || url.password) result.errors.push('Image URLs must not contain credentials.');
  if (!options.allowedHosts.includes(url.hostname.toLowerCase())) {
    result.errors.push(`Images must be hosted on ${options.allowedHosts.join(' or ') || 'an approved host (none configured)'}.`);
  }
  if (url.hostname.endsWith('.r2.dev')) result.errors.push('r2.dev URLs are for development only; use the custom image domain.');
  if (result.errors.length > 0) return result;

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Origin: options.gameOrigin, Accept: ALLOWED_TYPES.join(',') },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    result.errors.push('The image URL could not be reached.');
    return result;
  }
  if (response.status >= 300 && response.status < 400) {
    result.errors.push('The image URL redirects; paste the final image URL.');
    return result;
  }
  if (!response.ok) {
    result.errors.push(`The image URL returned HTTP ${response.status}.`);
    return result;
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  result.contentType = contentType;
  if (!(ALLOWED_TYPES as readonly string[]).includes(contentType)) {
    result.errors.push(`Unsupported file type "${contentType || 'unknown'}". Use JPEG, PNG or WebP.`);
  }

  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > 0) {
    result.bytes = length;
    if (length > options.maxBytes) {
      result.errors.push(`The file is ${(length / 1024 / 1024).toFixed(1)} MB; the limit is ${(options.maxBytes / 1024 / 1024).toFixed(1)} MB.`);
    }
  } else {
    result.warnings.push('The host did not report a file size.');
  }

  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (allowOrigin !== '*' && allowOrigin !== options.gameOrigin) {
    result.errors.push(`The image host does not allow ${options.gameOrigin} (CORS). Picture download would fail; update the bucket's CORS policy.`);
  }

  const cacheControl = response.headers.get('cache-control') ?? '';
  if (!/max-age=\d{4,}|immutable/.test(cacheControl)) {
    result.warnings.push('The image is not served with a long cache lifetime; use versioned URLs with a long max-age.');
  }

  const dims = readDimensions(await readHead(response, HEADER_BYTES));
  if (!dims) {
    result.errors.push('Could not read the image dimensions.');
  } else {
    result.width = dims.width;
    result.height = dims.height;
    if (!options.thumbnail) {
      if (Math.min(dims.width, dims.height) < MIN_IMAGE_SIDE) {
        result.errors.push(`The image is ${dims.width}×${dims.height}; it needs to be at least ${MIN_IMAGE_SIDE}×${MIN_IMAGE_SIDE}.`);
      }
      if (Math.abs(dims.width / dims.height - 1) > MAX_ASPECT_DEVIATION) {
        result.errors.push(`The image is ${dims.width}×${dims.height}. Pictures must be square; upload a square crop.`);
      }
      if (Math.max(dims.width, dims.height) > LARGE_IMAGE_SIDE) {
        result.warnings.push(`At ${dims.width}×${dims.height} the image is larger than phones need; around 1600×1600 is plenty.`);
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}
