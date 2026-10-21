import { useEffect, useState } from 'react';
import { parseCatalog, type PublicCatalog } from '../shared/catalog';
import type { Picture } from './model';
import { SAMPLE_PICTURES } from './pictures';
import { readStorage, writeStorage } from './storage';

/** Same-origin path served by the Worker from the published catalog object. */
export const CATALOG_URL = '/catalog.json';
const CACHE_KEY = 'shape-reveal:catalog:v1';
const FETCH_TIMEOUT_MS = 8000;

/** Where the pictures on screen came from. */
export type CatalogSource = 'live' | 'cached' | 'bundled';

export interface CatalogState {
  pictures: Picture[];
  source: CatalogSource;
  loading: boolean;
  version?: number;
}

/**
 * Fetch the published catalog. Falls back to the last good copy saved on this
 * device, then to the bundled sample art, so play never depends on the network.
 */
export async function loadCatalog(fetcher: typeof fetch = fetch): Promise<CatalogState> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetcher(CATALOG_URL, { signal: controller.signal, headers: { accept: 'application/json' } });
    clearTimeout(timer);
    if (response.ok) {
      const catalog = parseCatalog(await response.json());
      if (catalog && catalog.pictures.length > 0) {
        writeStorage(CACHE_KEY, catalog);
        return { pictures: catalog.pictures, source: 'live', loading: false, version: catalog.version };
      }
    }
  } catch {
    // Offline, timed out, or not deployed (local dev): use a fallback below.
  }
  const cached = parseCatalog(readStorage(CACHE_KEY));
  if (cached && cached.pictures.length > 0) {
    return { pictures: cached.pictures, source: 'cached', loading: false, version: cached.version };
  }
  return { pictures: SAMPLE_PICTURES, source: 'bundled', loading: false };
}

const initial: CatalogState = { pictures: SAMPLE_PICTURES, source: 'bundled', loading: true };

export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>(initial);
  useEffect(() => {
    let cancelled = false;
    void loadCatalog().then((result) => !cancelled && setState(result));
    return () => { cancelled = true; };
  }, []);
  return state;
}

export type { PublicCatalog };
