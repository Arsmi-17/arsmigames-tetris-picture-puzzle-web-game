import type { Picture } from './model';
import { MAX_CHALLENGE } from './challenge';

/**
 * Original sample artwork shipped in /public/assets. Always available, so the
 * game stays playable offline or when the catalog cannot be reached.
 */
export const SAMPLE_PICTURES: Picture[] = [
  {
    id: 'sample-aurora',
    title: 'Aurora Lake',
    theme: 'Calm',
    url: `${import.meta.env.BASE_URL}assets/aurora.svg`,
    alt: 'Green and violet aurora over mountains reflected in a still lake.',
    attribution: 'Shape Reveal sample art',
    minChallenge: 0,
    maxChallenge: MAX_CHALLENGE,
  },
  {
    id: 'sample-sunset',
    title: 'Sunset Cove',
    theme: 'Bright',
    url: `${import.meta.env.BASE_URL}assets/sunset.svg`,
    alt: 'Orange sun setting over a cove with cliffs and calm water.',
    attribution: 'Shape Reveal sample art',
    minChallenge: 0,
    maxChallenge: MAX_CHALLENGE,
  },
];

export interface LoadedPicture {
  /** False when the image displays but blocks canvas export (no CORS). */
  exportable: boolean;
}

export class PictureLoadError extends Error {}

const LOAD_TIMEOUT_MS = 15000;
const loaded = new Map<string, LoadedPicture>();

function tryLoad(url: string, crossOrigin: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => {
      image.src = '';
      resolve(false);
    }, LOAD_TIMEOUT_MS);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image.naturalWidth > 0);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    image.src = url;
  });
}

/**
 * Load a picture before a round starts. A CORS-enabled load is tried first
 * because PNG export draws the image into a canvas; if only a plain load
 * works the round is still playable but export is reported as unavailable.
 */
export async function loadPicture(url: string): Promise<LoadedPicture> {
  const cached = loaded.get(url);
  if (cached) return cached;
  let result: LoadedPicture | null = null;
  if (await tryLoad(url, true)) result = { exportable: true };
  else if (await tryLoad(url, false)) result = { exportable: false };
  if (!result) {
    throw new PictureLoadError(
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'You appear to be offline, so this picture could not load.'
        : 'This picture could not be loaded.',
    );
  }
  loaded.set(url, result);
  return result;
}

/** Warm the browser cache for the next likely picture. Errors are ignored. */
export function preloadPicture(url: string | undefined): void {
  if (url && !loaded.has(url)) void loadPicture(url).catch(() => undefined);
}
