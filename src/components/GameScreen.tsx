import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ChevronsDown,
  Pause,
  Play,
  Clock,
} from 'lucide-react';
import type { GameConfig, GameState } from '@/types';
import { GameBoard } from './GameBoard';
import { SPAWN_ROWS } from '@/gameLogic';
import { CELEBRATION_MS, HEAL_MS } from '@/celebration';

interface GameScreenProps {
  config: GameConfig;
  state: GameState;
  /** Plays the completion sequence before the win screen takes over. */
  celebrating?: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveDown: () => void;
  onHardDrop: () => void;
  onResume: () => void;
  onReset: () => void;
  onHome: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Measures the space left for the board and returns the largest cell size that
 * fits both axes. Re-measures on resize and orientation change so the same
 * layout works from a 320px phone up to a desktop window.
 */
function useCellSize(cols: number, rows: number) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const area = areaRef.current;
      if (!area) return;
      const { width, height } = area.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const byWidth = width / cols;
      const byHeight = height / (rows + SPAWN_ROWS);
      setCellSize(Math.max(12, Math.floor(Math.min(byWidth, byHeight))));
    };

    measure();

    const area = areaRef.current;
    const observer = new ResizeObserver(measure);
    if (area) observer.observe(area);
    window.addEventListener('orientationchange', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, [cols, rows]);

  return { areaRef, cellSize };
}

export function GameScreen({
  config,
  state,
  celebrating = false,
  onMoveLeft,
  onMoveRight,
  onMoveDown,
  onHardDrop,
  onResume,
  onReset,
  onHome,
}: GameScreenProps) {
  const { cols, rows } = config.difficulty;
  const { areaRef, cellSize } = useCellSize(cols, rows);
  const [showKeyHint, setShowKeyHint] = useState(false);

  // Header and controls line up with the board rather than the viewport, so a
  // wide window doesn't leave them floating far past the playfield edges.
  const rail: React.CSSProperties = cellSize > 0 ? { maxWidth: cols * cellSize } : {};

  // Only advertise keyboard controls once we know a keyboard is in play.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) setShowKeyHint(true);
  }, []);

  const padBtn =
    'pad-button relative overflow-hidden flex aspect-square w-full max-w-[5.5rem] items-center justify-center rounded-2xl bg-white text-brand-blue shadow-card transition hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95 disabled:opacity-40';

  return (
    <div
      className={`relative min-h-[100dvh] w-full ${celebrating ? 'animate-screen-dissolve' : ''}`}
      style={{ ['--celebration-ms' as string]: `${CELEBRATION_MS}ms` }}
    >
      <div className="brand-backdrop" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex h-[100dvh] w-full max-w-md flex-col gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:gap-4 sm:px-6 lg:max-w-xl lg:gap-5 lg:py-8">
        {/* ---- Header ---- */}
        <header
          style={{ ...rail, transition: `opacity ${HEAL_MS}ms ease-out` }}
          className={`mx-auto flex w-full shrink-0 items-center justify-between rounded-2xl bg-brand-mist px-5 py-4 shadow-card sm:px-6 ${
            celebrating ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <img src="/assets/intuit-logo.png" alt="Intuit" className="h-7 w-auto sm:h-8" />

          <div className="flex items-center gap-2 text-brand-ink">
            <Clock className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.25} />
            <span className="font-display text-2xl font-bold tabular-nums sm:text-3xl">
              {formatTime(state.elapsed)}
            </span>
          </div>
        </header>

        {/* ---- Keyboard hint (pointer devices / laptop only) ---- */}
        {showKeyHint && (
          <p
            style={rail}
            className="mx-auto hidden w-full shrink-0 text-xs text-brand-muted lg:block"
          >
            Keyboard: &larr; &darr; &rarr; &middot; Space to drop
          </p>
        )}

        {/* ---- Board ---- */}
        <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center">
          {cellSize > 0 && (
            <GameBoard state={state} config={config} cellSize={cellSize} celebrating={celebrating} />
          )}
        </div>

        {/* ---- D-pad ---- */}
        <div
          style={{ ...rail, transition: `opacity ${HEAL_MS}ms ease-out` }}
          className={`mx-auto flex w-full shrink-0 items-stretch justify-center gap-3 sm:gap-4 ${
            celebrating ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <button onClick={onMoveLeft} className={padBtn} aria-label="Move left">
            <ArrowLeft className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={2.25} />
          </button>
          <button onClick={onMoveDown} className={padBtn} aria-label="Move down">
            <ArrowDown className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={2.25} />
          </button>
          <button onClick={onMoveRight} className={padBtn} aria-label="Move right">
            <ArrowRight className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={2.25} />
          </button>
          <button onClick={onHardDrop} className={padBtn} aria-label="Drop at once">
            <ChevronsDown className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={2.25} />
          </button>
        </div>
      </div>

      {/* ---- Pause overlay ---- */}
      {state.paused && !state.won && (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-brand-sky/90 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm text-center">
            <Pause className="mx-auto mb-4 h-14 w-14 text-brand-blue" />
            <h2 className="font-display text-4xl font-bold text-brand-ink">Paused</h2>
            <p className="mt-2 text-brand-muted">Take a breather. Resume when ready.</p>

            <div className="mt-8 space-y-3">
              <button
                onClick={onResume}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-blue px-8 py-4 text-lg font-medium text-white shadow-cta transition hover:bg-brand-blue-dark active:scale-[0.98]"
              >
                <Play className="h-5 w-5" />
                Resume
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onReset}
                  className="flex-1 rounded-full bg-white px-6 py-3.5 font-medium text-brand-body shadow-card transition hover:bg-white/80 active:scale-[0.98]"
                >
                  Restart
                </button>
                <button
                  onClick={onHome}
                  className="flex-1 rounded-full bg-white px-6 py-3.5 font-medium text-brand-body shadow-card transition hover:bg-white/80 active:scale-[0.98]"
                >
                  Menu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
