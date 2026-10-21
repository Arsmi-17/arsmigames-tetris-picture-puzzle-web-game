import { useState } from 'react';
import { ArrowRight, Image as ImageIcon, Play, Sparkles, Trophy, WifiOff } from 'lucide-react';
import { MODES } from '@/challenge';
import { CHAPTER_LENGTH, type PersonalBests, type Run, type RunMode } from '@/model';
import type { CatalogSource } from '@/catalog';
import { plural } from '@/format';

interface HomeScreenProps {
  savedRun: Run | null;
  savedPictureTitle?: string;
  bests: PersonalBests;
  catalogLoading: boolean;
  catalogSource: CatalogSource;
  onStartRun: (mode: RunMode) => void;
  onResume: () => void;
  onFreePlay: () => void;
}

const BEST_TEXT: Record<RunMode, (b: PersonalBests) => string | null> = {
  relaxed: (b) => (b.relaxed.pictures ? `Best: ${plural(b.relaxed.pictures, 'picture')} · ${plural(b.relaxed.chapters, 'chapter')}` : null),
  arcade: (b) => (b.arcade.score ? `Best: ${plural(b.arcade.score, 'point')} · ${plural(b.arcade.pictures, 'picture')}` : null),
};

export function HomeScreen({ savedRun, savedPictureTitle, bests, catalogLoading, catalogSource, onStartRun, onResume, onFreePlay }: HomeScreenProps) {
  const [confirming, setConfirming] = useState<RunMode | null>(null);

  const start = (mode: RunMode) => {
    if (savedRun && confirming !== mode) {
      setConfirming(mode);
      return;
    }
    setConfirming(null);
    onStartRun(mode);
  };

  return (
    <main className="min-h-[100dvh] bg-[#0b1120] px-4 py-6 text-white sm:px-6 sm:py-10" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between gap-4 sm:mb-8">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-cyan-300"><Sparkles className="h-5 w-5" /> Shape Reveal</div>
          <span className="text-xs text-slate-400">Picture puzzle + falling blocks</span>
        </header>

        <div className="grid gap-6 sm:gap-10 lg:grid-cols-[1fr_1.08fr] lg:items-center">
          <section>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Make the picture whole</p>
            <h1 className="max-w-xl text-3xl font-black leading-tight tracking-tight sm:text-6xl">Every block holds <span className="text-cyan-300">a piece of the picture.</span></h1>
            <p className="mt-5 hidden max-w-lg text-base leading-relaxed text-slate-300 sm:block sm:text-lg">Guide falling shapes into their matching spaces. Each correct drop reveals more of the image. Finish a picture and the next one is waiting.</p>
            <div className="mt-7 hidden max-w-lg grid-cols-3 gap-2 text-center text-xs text-slate-300 sm:grid sm:text-sm">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">Move<br /><strong className="text-white">← →</strong></div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">Soft drop<br /><strong className="text-white">↓</strong></div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">Instant drop<br /><strong className="text-white">Space</strong></div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#151f32] p-5 shadow-2xl sm:p-7" aria-label="Choose how to play">
            {savedRun && (
              <button type="button" onClick={onResume} disabled={catalogLoading}
                className="mb-5 flex w-full items-center gap-4 rounded-2xl bg-cyan-300 p-4 text-left text-[#0b1120] transition hover:bg-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-60">
                <Play className="h-8 w-8 shrink-0" />
                <span className="min-w-0 flex-1">
                  <strong className="block text-lg">Continue {MODES[savedRun.mode].label} run</strong>
                  <span className="block truncate text-sm">Chapter {savedRun.chapter} · picture {savedRun.stage + 1} of {CHAPTER_LENGTH}{savedPictureTitle ? ` · ${savedPictureTitle}` : ''}</span>
                  <span className="block text-xs opacity-80">{savedRun.mode === 'arcade' ? `${plural(savedRun.score, 'point')} · ${plural(savedRun.mistakesLeft, 'miss', 'misses')} left` : `${plural(savedRun.picturesCompleted, 'picture')} finished`}</span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0" />
              </button>
            )}

            <h2 className="text-xl font-bold">{savedRun ? 'Or start a new run' : 'Choose a mood'}</h2>
            <div className="mt-4 grid gap-3">
              {(['relaxed', 'arcade'] as const).map((mode) => {
                const best = BEST_TEXT[mode](bests);
                return (
                  <div key={mode}>
                    <button type="button" onClick={() => start(mode)} disabled={catalogLoading}
                      className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-cyan-300/60 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-60">
                      <span className="min-w-0 flex-1">
                        <strong className="block text-lg">{MODES[mode].label}</strong>
                        <span className="mt-1 block text-sm leading-snug text-slate-300">{MODES[mode].description}</span>
                        {best && <span className="mt-2 flex items-center gap-1 text-xs text-amber-200"><Trophy className="h-3.5 w-3.5" /> {best}</span>}
                      </span>
                      <ArrowRight className="h-5 w-5 shrink-0 text-cyan-300" />
                    </button>
                    {confirming === mode && savedRun && (
                      <div role="alert" className="mt-2 rounded-xl bg-amber-300/10 p-3 text-sm text-amber-100">
                        This ends your saved {MODES[savedRun.mode].label} run.
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => start(mode)} className="rounded-lg bg-amber-300 px-3 py-1.5 font-semibold text-[#0b1120]">Start new run</button>
                          <button type="button" onClick={() => setConfirming(null)} className="rounded-lg bg-white/10 px-3 py-1.5">Keep it</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button type="button" onClick={onFreePlay} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm text-slate-200 hover:bg-white/10">
              <ImageIcon className="h-4 w-4" /> Free play: pick a picture and size, or use your own
            </button>

            <p className="mt-3 min-h-4 text-center text-xs text-slate-400" role="status">
              {catalogLoading
                ? 'Loading pictures…'
                : catalogSource === 'cached'
                  ? <span className="inline-flex items-center gap-1"><WifiOff className="h-3.5 w-3.5" /> Using pictures saved on this device.</span>
                  : catalogSource === 'bundled'
                    ? 'Using the built-in pictures.'
                    : ''}
            </p>
            <p className="mt-1 text-center text-xs text-slate-500">Progress is saved in this browser on this device only.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
