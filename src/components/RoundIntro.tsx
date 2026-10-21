import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Play, RefreshCw, SkipForward } from 'lucide-react';
import type { Challenge, Picture } from '@/model';
import { loadPicture } from '@/pictures';

interface RoundIntroProps {
  picture: Picture;
  challenge: Challenge;
  /** Context line, e.g. "Chapter 2 · Picture 3 of 5". */
  eyebrow?: string;
  /** Called once the picture is ready and the preview is over. */
  onStart: (exportable: boolean) => void;
  /** Offered when the picture fails to load; omitted in Free play. */
  onSkip?: () => void;
  onBack: () => void;
  backLabel?: string;
  /** Reported once per failed load attempt. */
  onLoadError?: (message: string) => void;
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; exportable: boolean } | { kind: 'error'; message: string };

/**
 * Loads the round's picture and shows it briefly with the challenge, so the
 * player knows what they are building. Load failures offer retry or skip.
 */
export function RoundIntro({ picture, challenge, eyebrow, onStart, onSkip, onBack, backLabel = 'Menu', onLoadError }: RoundIntroProps) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const startRef = useRef<HTMLButtonElement>(null);
  const started = useRef(false);
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  const start = useCallback((exportable: boolean) => {
    if (started.current) return;
    started.current = true;
    onStartRef.current(exportable);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    loadPicture(picture.url).then(
      (result) => !cancelled && setLoad({ kind: 'ready', exportable: result.exportable }),
      (error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'This picture could not be loaded.';
        setLoad({ kind: 'error', message });
        onLoadErrorRef.current?.(message);
      },
    );
    return () => { cancelled = true; };
  }, [picture.url, attempt]);

  const previewMs = challenge.previewMs;

  useEffect(() => {
    if (load.kind !== 'ready') return;
    if (previewMs <= 0) {
      start(load.exportable);
      return;
    }
    startRef.current?.focus();
    const timer = window.setTimeout(() => start(load.exportable), previewMs);
    return () => window.clearTimeout(timer);
  }, [load, previewMs, start]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#0b1120] px-4 py-6 text-white" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
      <div className="w-full max-w-md text-center">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">{eyebrow}</p>}
        <h1 className="mt-2 text-3xl font-black tracking-tight">{picture.title}</h1>
        <p className="mt-1 text-sm text-slate-300">{challenge.label} · {(challenge.cols * challenge.rows) / 4} shapes</p>

        <div className="relative mx-auto mt-5 aspect-square w-full max-w-[min(100%,60dvh)] overflow-hidden rounded-3xl border border-white/10 bg-[#151f32]">
          {load.kind === 'ready' && <img src={picture.url} alt={picture.alt} className="h-full w-full object-cover animate-preview-in" />}
          {load.kind === 'loading' && <div className="flex h-full items-center justify-center text-sm text-slate-300" role="status">Loading picture…</div>}
          {load.kind === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6" role="alert">
              <ImageOff className="h-10 w-10 text-rose-300" />
              <p className="text-sm text-slate-200">{load.message}</p>
            </div>
          )}
          {load.kind === 'ready' && previewMs > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10"><div className="h-full bg-cyan-300 animate-preview-bar" style={{ animationDuration: `${previewMs}ms` }} /></div>
          )}
        </div>
        {picture.attribution && <p className="mt-2 text-xs text-slate-400">{picture.attribution}</p>}

        <div className="mt-5 flex flex-col gap-3">
          {load.kind === 'ready' && (
            <button ref={startRef} type="button" onClick={() => start(load.exportable)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-4 font-bold text-[#0b1120] hover:bg-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"><Play className="h-5 w-5" /> Start now</button>
          )}
          {load.kind === 'error' && (
            <div className="flex gap-3">
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 font-bold text-[#0b1120] hover:bg-cyan-200"><RefreshCw className="h-4 w-4" /> Retry</button>
              {onSkip && <button type="button" onClick={onSkip} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 font-medium hover:bg-white/20"><SkipForward className="h-4 w-4" /> Skip picture</button>}
            </div>
          )}
          <button type="button" onClick={onBack} className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white">{backLabel}</button>
        </div>
      </div>
    </main>
  );
}
