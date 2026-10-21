// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { GameScreen } from '@/components/GameScreen';
import { useGameEngine, REJECT_FLASH_MS } from '@/useGameEngine';
import { SAMPLE_PICTURES } from '@/pictures';
import { FREE_PLAY_SIZES, MODES } from '@/challenge';
import type { GameConfig } from '@/types';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 360, height: 600, top: 0, left: 0, right: 360, bottom: 600, x: 0, y: 0, toJSON() {} });
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const config = (overrides: Partial<GameConfig> = {}): GameConfig => ({
  picture: SAMPLE_PICTURES[0],
  challenge: { ...FREE_PLAY_SIZES[2], fallMs: 60_000 },
  rules: { wrongPenalty: 25, hintCost: 0, landingPreview: false },
  seed: 7,
  ...overrides,
});

function Harness({ cfg }: { cfg: GameConfig }) {
  const stable = useMemo(() => cfg, [cfg]);
  const engine = useGameEngine(stable);
  return (
    <>
      <output data-testid="col">{engine.state.currentPiece?.col ?? 'none'}</output>
      <output data-testid="row">{engine.state.currentPiece?.row ?? 'none'}</output>
      <output data-testid="placed">{engine.state.placedCount}</output>
      <GameScreen config={stable} state={engine.state} onToggleHint={engine.toggleHint} onMoveLeft={engine.moveLeft} onMoveRight={engine.moveRight}
        onMoveDown={engine.moveDown} onHardDrop={engine.hardDrop} onPause={engine.pause} onResume={engine.resume} onReset={engine.reset} onHome={() => undefined} />
    </>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe('touch controls', () => {
  it('move, soft-drop and drop buttons drive the falling piece', () => {
    render(<Harness cfg={config()} />);
    const startCol = Number(text('col'));
    fireEvent.click(screen.getByRole('button', { name: 'Move left' }));
    expect(Number(text('col'))).toBe(startCol - 1);
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }));
    expect(Number(text('col'))).toBe(startCol + 1);
    const row = Number(text('row'));
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }));
    expect(Number(text('row'))).toBe(row + 1);
    const pieceBefore = text('col') + text('row');
    fireEvent.click(screen.getByRole('button', { name: 'Drop at once' }));
    expect(text('col') + text('row')).not.toBe(pieceBefore);
  });

  it('pause opens a focused dialog that blocks input until resumed', () => {
    render(<Harness cfg={config()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause game' }));
    const dialog = screen.getByRole('dialog', { name: 'Paused' });
    expect(dialog).toBeTruthy();
    expect(document.activeElement?.textContent).toContain('Resume');
    const col = text('col');
    fireEvent.click(screen.getByRole('button', { name: 'Move left' }));
    expect(text('col')).toBe(col);
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keyboard arrows and P work like the buttons', () => {
    render(<Harness cfg={config()} />);
    const col = Number(text('col'));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(Number(text('col'))).toBe(col + 1);
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the landing guide only when the rules ask for it', () => {
    const { unmount } = render(<Harness cfg={config({ rules: MODES.relaxed.rules })} />);
    expect(screen.getAllByTestId('landing-guide').length).toBe(4);
    unmount();
    render(<Harness cfg={config()} />);
    expect(screen.queryAllByTestId('landing-guide').length).toBe(0);
  });

  it('shows the hint cost in Arcade', () => {
    render(<Harness cfg={config({ rules: MODES.arcade.rules })} />);
    expect(screen.getByRole('button', { name: /Hint \(−40\)/ })).toBeTruthy();
  });
});

describe('engine hook timing', () => {
  it('a wrong drop blinks out, then the next piece spawns', () => {
    vi.useFakeTimers();
    const cfg = config();
    const { result } = renderHook(() => useGameEngine(cfg));
    const target = result.current.state.targets.get(result.current.state.currentPiece!.id)!;
    const away = target.col >= 4 ? -1 : 1;
    act(() => {
      for (let i = 0; i < 8; i += 1) (away < 0 ? result.current.moveLeft : result.current.moveRight)();
    });
    act(() => result.current.hardDrop());
    expect(result.current.state.rejectedPiece).not.toBeNull();
    expect(result.current.state.currentPiece).toBeNull();
    act(() => { vi.advanceTimersByTime(REJECT_FLASH_MS); });
    expect(result.current.state.rejectedPiece).toBeNull();
    expect(result.current.state.currentPiece).not.toBeNull();
  });

  it('pausing during the blink holds the retry until resume', () => {
    vi.useFakeTimers();
    const cfg = config({ seed: 11 });
    const { result } = renderHook(() => useGameEngine(cfg));
    const target = result.current.state.targets.get(result.current.state.currentPiece!.id)!;
    act(() => {
      for (let i = 0; i < 8; i += 1) (target.col >= 4 ? result.current.moveLeft : result.current.moveRight)();
    });
    act(() => result.current.hardDrop());
    expect(result.current.state.rejectedPiece).not.toBeNull();
    act(() => result.current.pause());
    act(() => { vi.advanceTimersByTime(REJECT_FLASH_MS * 3); });
    expect(result.current.state.rejectedPiece).not.toBeNull();
    act(() => result.current.resume());
    act(() => { vi.advanceTimersByTime(REJECT_FLASH_MS); });
    expect(result.current.state.currentPiece).not.toBeNull();
  });

  it('gravity moves the piece down on the fall interval and the clock counts', () => {
    vi.useFakeTimers();
    const cfg = config({ challenge: { ...FREE_PLAY_SIZES[2], fallMs: 500 } });
    const { result } = renderHook(() => useGameEngine(cfg));
    const row = result.current.state.currentPiece!.row;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.state.currentPiece!.row).toBe(row + 2);
    expect(result.current.state.elapsed).toBe(1);
  });
});
