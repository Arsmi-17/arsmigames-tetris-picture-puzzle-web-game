import { useEffect, useRef } from 'react';
import { ArrowRight, Flag, Home, RotateCcw, Trophy } from 'lucide-react';
import { MODES } from '@/challenge';
import { formatTime } from '@/format';
import { CHAPTER_LENGTH, type Picture, type RoundResult, type Run } from '@/model';

/** Five dots showing where the player is in the chapter. */
export function ChapterProgress({ stage, done }: { stage: number; done: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Picture ${Math.min(stage + 1, CHAPTER_LENGTH)} of ${CHAPTER_LENGTH} in this chapter`}>
      {Array.from({ length: CHAPTER_LENGTH }, (_, i) => (
        <span key={i} className={`h-2 w-6 rounded-full ${i < done ? 'bg-cyan-300' : i === stage ? 'bg-cyan-300/40' : 'bg-white/15'}`} />
      ))}
    </div>
  );
}

interface ChapterRecapProps {
  chapter: number;
  results: RoundResult[];
  pictures: Map<string, Picture>;
  run: Run;
  improved: string[];
  onContinue: () => void;
  onHome: () => void;
}

/** Milestone between chapters: an album page of the finished pictures. */
export function ChapterRecap({ chapter, results, pictures, run, improved, onContinue, onHome }: ChapterRecapProps) {
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => continueRef.current?.focus(), []);
  const seconds = results.reduce((sum, r) => sum + r.seconds, 0);
  const mistakes = results.reduce((sum, r) => sum + r.mistakes, 0);

  return (
    <main className="min-h-[100dvh] bg-[#0b1120] px-4 py-8 text-white sm:px-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
      <div className="mx-auto max-w-2xl text-center animate-pop-in">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Chapter {chapter} complete</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Album page filled</h1>
        <ul className="mx-auto mt-6 grid max-w-lg grid-cols-5 gap-2" aria-label="Pictures in this chapter">
          {results.map((r, i) => {
            const p = pictures.get(r.pictureId);
            return (
              <li key={`${r.pictureId}-${i}`} className="overflow-hidden rounded-xl border border-white/10 bg-[#151f32]">
                {p ? <img src={p.thumbUrl ?? p.url} alt={p.title} className="aspect-square w-full object-cover" /> : <div className="aspect-square" />}
              </li>
            );
          })}
        </ul>
        <dl className="mx-auto mt-6 grid max-w-lg grid-cols-3 gap-3">
          <div className="rounded-2xl bg-[#151f32] p-3"><dt className="text-xs text-slate-400">Time</dt><dd className="text-xl font-bold tabular-nums">{formatTime(seconds)}</dd></div>
          <div className="rounded-2xl bg-[#151f32] p-3"><dt className="text-xs text-slate-400">Misses</dt><dd className="text-xl font-bold tabular-nums">{mistakes}</dd></div>
          <div className="rounded-2xl bg-[#151f32] p-3"><dt className="text-xs text-slate-400">{run.mode === 'arcade' ? 'Run score' : 'Pictures'}</dt><dd className="text-xl font-bold tabular-nums">{run.mode === 'arcade' ? run.score.toLocaleString() : run.picturesCompleted}</dd></div>
        </dl>
        {run.mode === 'arcade' && <p className="mt-3 text-sm text-slate-300">A miss has been restored: {run.mistakesLeft} of {MODES.arcade.mistakeBudget} left.</p>}
        {improved.length > 0 && <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-amber-200"><Trophy className="h-4 w-4" /> New personal best!</p>}
        <button ref={continueRef} type="button" onClick={onContinue} className="mt-7 inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-4 font-bold text-[#0b1120] hover:bg-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
          Start chapter {run.chapter} <ArrowRight className="h-5 w-5" />
        </button>
        <button type="button" onClick={onHome} className="mx-auto mt-3 flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/10"><Home className="h-4 w-4" /> Save and exit</button>
      </div>
    </main>
  );
}

interface RunOverProps {
  run: Run;
  improved: string[];
  /** Why it ended: Arcade misses ran out, or the player chose to stop. */
  reason: 'misses' | 'stopped';
  onNewRun: () => void;
  onHome: () => void;
}

export function RunOverScreen({ run, improved, reason, onNewRun, onHome }: RunOverProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => primaryRef.current?.focus(), []);
  const chapters = run.chapter - 1;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#0b1120] px-4 py-8 text-white" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
      <div className="w-full max-w-md text-center animate-pop-in">
        <Flag className="mx-auto h-10 w-10 text-cyan-300" />
        <p className="mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">{MODES[run.mode].label} run complete</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">{reason === 'misses' ? 'Out of misses' : 'Nicely played'}</h1>
        <p className="mt-3 text-slate-300">{reason === 'misses' ? 'Your run ends here — every finished picture still counts.' : 'Your run is saved to your personal bests.'}</p>
        <dl className="mt-6 grid grid-cols-3 gap-3">
          {run.mode === 'arcade' && <div className="rounded-2xl bg-[#151f32] p-3"><dt className="text-xs text-slate-400">Score</dt><dd className="text-xl font-bold tabular-nums">{run.score.toLocaleString()}</dd></div>}
          <div className="rounded-2xl bg-[#151f32] p-3"><dt className="text-xs text-slate-400">Pictures</dt><dd className="text-xl font-bold tabular-nums">{run.picturesCompleted}</dd></div>
          <div className="rounded-2xl bg-[#151f32] p-3"><dt className="text-xs text-slate-400">Chapters</dt><dd className="text-xl font-bold tabular-nums">{chapters}</dd></div>
          {run.mode === 'relaxed' && <div className="rounded-2xl bg-[#151f32] p-3"><dt className="text-xs text-slate-400">Clean streak</dt><dd className="text-xl font-bold tabular-nums">{run.streak}</dd></div>}
        </dl>
        {improved.length > 0 && <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-amber-200"><Trophy className="h-4 w-4" /> New personal best!</p>}
        <button ref={primaryRef} type="button" onClick={onNewRun} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-4 font-bold text-[#0b1120] hover:bg-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"><RotateCcw className="h-5 w-5" /> New {MODES[run.mode].label} run</button>
        <button type="button" onClick={onHome} className="mt-3 w-full rounded-xl bg-white/10 px-4 py-3 font-medium hover:bg-white/20">Menu</button>
      </div>
    </main>
  );
}
