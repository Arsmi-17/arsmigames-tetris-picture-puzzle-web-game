// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCatalog } from '@/catalog';
import { SAMPLE_PICTURES } from '@/pictures';
import { parseCatalog } from '../shared/catalog';

const good = {
  schema: 1,
  version: 4,
  generatedAt: '2026-10-21T00:00:00Z',
  pictures: [
    { id: 'lake-a1', title: 'Lake', theme: 'Calm', url: 'https://images.example.com/lake.png', alt: 'A lake.', minChallenge: 0, maxChallenge: 7 },
  ],
};

const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;

beforeEach(() => localStorage.clear());

describe('catalog loading', () => {
  it('uses the live catalog and remembers it', async () => {
    const live = await loadCatalog(respond(good));
    expect(live.source).toBe('live');
    expect(live.pictures.map((p) => p.id)).toEqual(['lake-a1']);
    const cached = await loadCatalog(offline);
    expect(cached.source).toBe('cached');
    expect(cached.version).toBe(4);
  });

  it('falls back to the bundled art when offline with nothing cached', async () => {
    const result = await loadCatalog(offline);
    expect(result.source).toBe('bundled');
    expect(result.pictures).toEqual(SAMPLE_PICTURES);
  });

  it('ignores error responses and empty catalogs', async () => {
    expect((await loadCatalog(respond({ error: 'nope' }, 404))).source).toBe('bundled');
    expect((await loadCatalog(respond({ ...good, pictures: [] }))).source).toBe('bundled');
  });

  it('survives storage that throws', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('QuotaExceeded'); };
    try {
      expect((await loadCatalog(respond(good))).source).toBe('live');
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('catalog parsing', () => {
  it('drops unsafe or malformed entries instead of failing', () => {
    const parsed = parseCatalog({
      ...good,
      pictures: [
        good.pictures[0],
        { ...good.pictures[0] }, // duplicate id
        { ...good.pictures[0], id: 'http-pic', url: 'http://images.example.com/x.png' },
        { ...good.pictures[0], id: 'js-pic', url: 'javascript:alert(1)' },
        { ...good.pictures[0], id: 'Bad ID' },
        { ...good.pictures[0], id: 'range', minChallenge: 5, maxChallenge: 2 },
        { ...good.pictures[0], id: 'no-alt', alt: '' },
        'nonsense',
      ],
    });
    expect(parsed?.pictures.map((p) => p.id)).toEqual(['lake-a1']);
  });

  it('rejects unknown schemas', () => {
    expect(parseCatalog({ ...good, schema: 2 })).toBeNull();
    expect(parseCatalog(null)).toBeNull();
  });
});
