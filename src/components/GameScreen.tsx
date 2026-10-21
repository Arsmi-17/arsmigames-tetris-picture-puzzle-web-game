import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ChevronsDown, Clock3, Lightbulb, Pause, Play, RotateCcw } from 'lucide-react';
import type { GameConfig, GameState } from '@/types';
import { formatTime } from '@/format';
import { GameBoard } from './GameBoard';
import { SPAWN_ROWS } from '@/gameLogic';
import { CELEBRATION_MS } from '@/celebration';

interface GameScreenProps {
  config: GameConfig;
  state: GameState;
  celebrating?: boolean;
  /** Second header line; defaults to picture and board size. */
  subtitle?: string;
  /** Extra header content, such as Arcade misses left. */
  status?: ReactNode;
  /** Label for the pause panel's exit button. */
  exitLabel?: string;
  onToggleHint: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveDown: () => void;
  onHardDrop: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onHome: () => void;
}

function useCellSize(cols: number, rows: number) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(0);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => {
      const { width, height } = area.getBoundingClientRect();
      if (width > 0 && height > 0) setCellSize(Math.max(12, Math.floor(Math.min(width / cols, height / (rows + SPAWN_ROWS)))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [cols, rows]);

  return { areaRef, cellSize };
}

export function GameScreen({ config, state, celebrating = false, subtitle, status, exitLabel = 'Menu', onToggleHint, onMoveLeft, onMoveRight, onMoveDown, onHardDrop, onPause, onResume, onReset, onHome }: GameScreenProps) {
  const { cols, rows } = config.challenge;
  const { areaRef, cellSize } = useCellSize(cols, rows);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const showHint = state.hintOn;
  const hintCost = config.rules.hintCost;

  useEffect(() => {
    if (state.paused) resumeRef.current?.focus();
  }, [state.paused]);
  const percent = state.totalPieces ? Math.round((state.placedCount / state.totalPieces) * 100) : 0;
  const button = 'flex h-14 w-full items-center justify-center rounded-2xl border border-white/10 bg-[#25334a] text-white shadow-lg transition hover:bg-[#354861] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-95 disabled:opacity-40 sm:h-16';

  return (
    <div className={`relative min-h-[100dvh] bg-[#0b1120] text-white ${celebrating ? 'animate-screen-dissolve' : ''}`} style={{ ['--celebration-ms' as string]: `${CELEBRATION_MS}ms` }}>
      <div className="mx-auto flex h-[100dvh] w-full max-w-3xl flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+6.25rem)] pt-3 sm:px-6 sm:pt-5">
        <header className="shrink-0 rounded-2xl border border-white/10 bg-[#151f32] px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-cyan-300">Shape Reveal</div>
              <div className="truncate text-xs text-slate-300">{subtitle ?? `${config.picture.title} · ${config.challenge.label}`}</div>
            </div>
            <div className="flex items-center gap-3 sm:gap-5">
              {status}
              <div className="text-right text-xs text-slate-300"><span className="block">Score</span><strong className="text-base text-white">{state.score}</strong></div>
              <div className="flex items-center gap-1 text-lg font-bold tabular-nums"><Clock3 className="h-4 w-4 text-cyan-300" />{formatTime(state.elapsed)}</div>
              <button type="button" onClick={onPause} aria-label="Pause game" className="rounded-lg p-2 text-slate-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><Pause className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3" aria-label={`${percent}% complete`}>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${percent}%` }} /></div>
            <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-300">{percent}%</span>
          </div>
        </header>

        <div className="mt-2 flex shrink-0 items-center justify-between text-xs text-slate-400">
          <span>Place each picture fragment in its matching space.</span>
          <button type="button" onClick={onToggleHint} aria-pressed={showHint} title={hintCost ? `Each hinted piece costs ${hintCost} points` : undefined} className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${showHint ? 'bg-cyan-300/20 text-cyan-200' : 'hover:text-white'}`}><Lightbulb className="h-4 w-4" /> Hint{hintCost ? ` (−${hintCost})` : ''}</button>
        </div>

        <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden py-2">
          {cellSize > 0 && <GameBoard state={state} config={config} cellSize={cellSize} celebrating={celebrating} />}
        </div>
      </div>

      <div className={`fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#10192a]/95 px-4 pt-3 backdrop-blur sm:px-6 ${celebrating ? 'pointer-events-none opacity-0' : ''}`} style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
        <div className="mx-auto grid max-w-xl grid-cols-4 gap-3">
          <button type="button" onClick={onMoveLeft} aria-label="Move left" className={button}><ArrowLeft className="h-7 w-7" /></button>
          <button type="button" onClick={onMoveDown} aria-label="Move down" className={button}><ArrowDown className="h-7 w-7" /></button>
          <button type="button" onClick={onMoveRight} aria-label="Move right" className={button}><ArrowRight className="h-7 w-7" /></button>
          <button type="button" onClick={onHardDrop} aria-label="Drop at once" className={`${button} !bg-cyan-300 !text-[#0b1120] hover:!bg-cyan-200`}><ChevronsDown className="h-7 w-7" /></button>
        </div>
      </div>

      {state.paused && !state.won && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1120]/95 p-5 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="pause-title" className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#151f32] p-7 text-center shadow-2xl">
            <Pause className="mx-auto h-10 w-10 text-cyan-300" />
            <h2 id="pause-title" className="mt-3 text-3xl font-bold">Paused</h2>
            <p className="mt-2 text-sm text-slate-300">Your picture is waiting.</p>
            <button ref={resumeRef} type="button" onClick={onResume} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-4 font-bold text-[#0b1120] hover:bg-cyan-200"><Play className="h-5 w-5" /> Resume</button>
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={onReset} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-white/10 px-4 py-3 text-sm hover:bg-white/20"><RotateCcw className="h-4 w-4" /> Restart</button>
              <button type="button" onClick={onHome} className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-sm hover:bg-white/20">{exitLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
