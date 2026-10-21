// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { CHAPTER_LENGTH } from '@/model';
import { configureAnalytics, flush } from '@/analytics';

const CELL = 75; // 360×600 area, 4×4 board + 4 spawn rows

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 360, height: 600, top: 0, left: 0, right: 360, bottom: 600, x: 0, y: 0, toJSON() {} });
  // Reduced motion collapses the completion animation so tests run quickly.
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  // Pictures "load" immediately with CORS.
  globalThis.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1024;
    crossOrigin = '';
    set src(value: string) {
      if (value) setTimeout(() => this.onload?.(), 0);
    }
  } as unknown as typeof Image;
});

beforeEach(() => {
  localStorage.clear();
  // Catalog unavailable: the bundled sample pictures are used.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const left = (el: Element) => parseFloat((el as HTMLElement).style.left);

/** Use the hint outline to steer the falling piece onto its target, then drop. */
async function placeCurrentPiece() {
  const target = Math.min(...screen.getAllByTestId('hint-cell').map(left));
  const current = Math.min(...screen.getAllByTestId('falling-cell').map(left));
  const steps = Math.round((target - current) / currentCellSize());
  for (let i = 0; i < Math.abs(steps); i += 1) fireEvent.keyDown(window, { key: steps > 0 ? 'ArrowRight' : 'ArrowLeft' });
  fireEvent.keyDown(window, { key: ' ' });
}

function currentCellSize() {
  const cell = screen.getAllByTestId('falling-cell')[0] as HTMLElement;
  return parseFloat(cell.style.width) || CELL;
}

/** Wait for the round intro, start it, and solve the whole picture. */
async function playPicture() {
  fireEvent.click(await screen.findByRole('button', { name: /Start now/ }));
  await screen.findByRole('button', { name: 'Drop at once' });
  if (screen.getByRole('button', { name: /Hint/ }).getAttribute('aria-pressed') !== 'true') {
    fireEvent.click(screen.getByRole('button', { name: /Hint/ }));
  }
  for (let guard = 0; guard < 60 && screen.queryAllByTestId('falling-cell').length > 0; guard += 1) {
    await act(async () => { await placeCurrentPiece(); });
  }
  return screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
}

const subtitle = () => screen.getByText(/Ch \d+ · \d\/5/).textContent ?? '';

describe('endless run', () => {
  it('plays a chapter, shows the recap, continues, and resumes after a reload', async () => {
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Relaxed/ }));

    const seen: string[] = [];
    for (let i = 0; i < CHAPTER_LENGTH; i += 1) {
      await screen.findByRole('button', { name: /Start now/ });
      seen.push(screen.getByRole('heading', { level: 1 }).textContent ?? '');
      const heading = await playPicture();
      expect(heading.textContent).toMatch(/Clean sweep!|Picture perfect\./);
      expect(screen.getByText(new RegExp(`Picture ${i + 1} of 5`))).toBeTruthy();
      const next = screen.getByRole('button', { name: i < CHAPTER_LENGTH - 1 ? /Next picture/ : /Finish chapter/ });
      fireEvent.click(next);
    }
    // Two bundled pictures, never the same one twice in a row.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).not.toBe(seen[i - 1]);

    expect(await screen.findByText('Chapter 1 complete')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(CHAPTER_LENGTH);
    fireEvent.click(screen.getByRole('button', { name: /Start chapter 2/ }));
    expect(await screen.findByText(/Chapter 2 · Picture 1 of 5/)).toBeTruthy();

    // Reload mid-chapter: the run resumes at the same picture.
    const title = screen.getByRole('heading', { level: 1 }).textContent;
    unmount();
    render(<App />);
    const resume = await screen.findByRole('button', { name: /Continue Relaxed run/ });
    expect(resume.textContent).toContain('Chapter 2 · picture 1 of 5');
    await waitFor(() => expect(resume.hasAttribute('disabled')).toBe(false));
    fireEvent.click(resume);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(title);
    fireEvent.click(await screen.findByRole('button', { name: /Start now/ }));
    await screen.findByRole('button', { name: 'Drop at once' });
    expect(subtitle()).toContain('Ch 2 · 1/5');
  });

  it('Arcade ends the run when the misses run out and records a personal best', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Arcade/ }));
    await playPicture();
    fireEvent.click(screen.getByRole('button', { name: /Next picture/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Start now/ }));
    await screen.findByRole('button', { name: 'Drop at once' });
    expect(screen.getByLabelText('5 misses left')).toBeTruthy();

    for (let misses = 0; misses < 5; misses += 1) {
      await waitFor(() => expect(screen.queryAllByTestId('falling-cell').length).toBeGreaterThan(0), { timeout: 3000 });
      fireEvent.click(screen.getByRole('button', { name: /Hint/ }));
      const hinted = screen.queryAllByTestId('hint-cell');
      const target = hinted.length ? Math.min(...hinted.map(left)) : 0;
      if (hinted.length) fireEvent.click(screen.getByRole('button', { name: /Hint/ }));
      const current = Math.min(...screen.getAllByTestId('falling-cell').map(left));
      // Push to the far side from the target, then drop.
      const key = target >= current ? 'ArrowLeft' : 'ArrowRight';
      for (let i = 0; i < 6; i += 1) fireEvent.keyDown(window, { key });
      const before = screen.queryByLabelText(`${5 - misses} misses left`);
      fireEvent.keyDown(window, { key: ' ' });
      if (before && screen.queryByLabelText(`${5 - misses} misses left`)) {
        // Landed on target by chance; try the next piece.
        misses -= 1;
      }
    }
    expect(await screen.findByText('Out of misses')).toBeTruthy();
    expect(screen.getByText(/New personal best/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(await screen.findByText(/Best: [\d,]+ points · 1 picture$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
  });

  it('sends a few anonymous events per picture, never one per move, and no URLs', async () => {
    const payloads: string[] = [];
    configureAnalytics({ enabled: true, sender: (body) => payloads.push(body) });
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /^Relaxed/ }));
      await playPicture();
      fireEvent.click(screen.getByRole('button', { name: /Next picture/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Start now/ }));
      await screen.findByRole('button', { name: 'Drop at once' });
      fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
      fireEvent.click(screen.getByRole('button', { name: /Save and exit/ }));
      flush();
      const events = payloads.flatMap((p) => JSON.parse(p).events as { name: string; runId?: string }[]);
      expect(events.map((e) => e.name).filter((n) => n !== 'client_error')).toEqual([
        'run_started', 'picture_started', 'hint_used', 'picture_completed', 'picture_started',
      ]);
      expect(new Set(events.filter((e) => e.runId).map((e) => e.runId)).size).toBe(1);
      expect(payloads.join('')).not.toMatch(/:\/\/|\/assets\//);
    } finally {
      configureAnalytics({ enabled: false });
    }
  });

  it('Free play still works with the bundled pictures', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Free play/ }));
    fireEvent.click(screen.getByRole('button', { name: /Easy/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start puzzle/ }));
    await screen.findByRole('button', { name: 'Drop at once' });
    fireEvent.click(screen.getByRole('button', { name: /Hint/ }));
    for (let guard = 0; guard < 30 && screen.queryAllByTestId('falling-cell').length > 0; guard += 1) {
      await act(async () => { await placeCurrentPiece(); });
    }
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Picture perfect.');
    expect(screen.getByRole('button', { name: /Download completed picture/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Play again/ })).toBeTruthy();
  });
});
