import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { challengeFor, rulesFor } from '@/challenge';
import { GameScreen } from '@/components/GameScreen';
import { RoundIntro } from '@/components/RoundIntro';
import { useGameEngine } from '@/useGameEngine';
import { randomSeed } from '@/random';
import type { Picture, RunMode } from '@/model';
import type { GameConfig } from '@/types';
import type { AdminPicture } from './api';

interface AdminPreviewProps {
  picture: AdminPicture;
  onClose: () => void;
}

function toPicture(row: AdminPicture): Picture {
  return {
    id: row.id,
    title: row.title,
    theme: row.theme,
    url: row.url,
    thumbUrl: row.thumb_url ?? undefined,
    alt: row.alt,
    attribution: row.attribution ?? undefined,
    license: row.license ?? undefined,
    minChallenge: row.min_challenge,
    maxChallenge: row.max_challenge,
  };
}

/**
 * Plays a round with a draft or published picture exactly as a player would
 * see it, without making the picture public.
 */
export function AdminPreview({ picture, onClose }: AdminPreviewProps) {
  const [level, setLevel] = useState(picture.min_challenge);
  const [mode, setMode] = useState<RunMode>('relaxed');
  const [phase, setPhase] = useState<'setup' | 'intro' | 'playing'>('setup');
  const [seed, setSeed] = useState(randomSeed);
  const config = useMemo<GameConfig>(() => ({
    picture: toPicture(picture),
    challenge: challengeFor(level, mode),
    rules: rulesFor(mode),
    seed,
  }), [picture, level, mode, seed]);
  const engine = useGameEngine(phase === 'playing' ? config : null);

  useEffect(() => {
    if (phase !== 'setup') return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  if (phase === 'intro') {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <RoundIntro picture={config.picture} challenge={config.challenge} eyebrow="Admin preview" onStart={() => setPhase('playing')} onBack={() => setPhase('setup')} backLabel="Back to preview settings" />
      </div>
    );
  }

  if (phase === 'playing' && engine.state.board.length > 0) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden">
        {engine.state.won ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#0b1120] p-6 text-center">
            <h2 className="text-3xl font-black">Preview complete</h2>
            <p className="text-slate-300">{engine.state.totalPieces} shapes · {engine.state.mistakes} misses · {engine.state.elapsed}s</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setSeed(randomSeed()); setPhase('intro'); }} className="rounded-xl bg-cyan-300 px-5 py-3 font-bold text-[#0b1120]">Play again</button>
              <button type="button" onClick={() => setPhase('setup')} className="rounded-xl bg-white/10 px-5 py-3">Settings</button>
            </div>
          </div>
        ) : (
          <GameScreen
            config={config}
            state={engine.state}
            subtitle={`Preview · ${config.challenge.label}`}
            exitLabel="End preview"
            onToggleHint={engine.toggleHint}
            onMoveLeft={engine.moveLeft}
            onMoveRight={engine.moveRight}
            onMoveDown={engine.moveDown}
            onHardDrop={engine.hardDrop}
            onPause={engine.pause}
            onResume={engine.resume}
            onReset={engine.reset}
            onHome={() => setPhase('setup')}
          />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1120]/90 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="preview-title" className="w-full max-w-md rounded-3xl border border-white/10 bg-[#151f32] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 id="preview-title" className="text-xl font-bold">Preview “{picture.title}”</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <label className="mt-4 block text-sm font-medium">Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as RunMode)} className="mt-1 w-full rounded-xl border border-white/15 bg-[#0b1120] px-3 py-2 text-sm">
            <option value="relaxed">Relaxed</option>
            <option value="arcade">Arcade</option>
          </select>
        </label>
        <label className="mt-3 block text-sm font-medium">Challenge
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-white/15 bg-[#0b1120] px-3 py-2 text-sm">
            {Array.from({ length: picture.max_challenge - picture.min_challenge + 1 }, (_, i) => picture.min_challenge + i).map((l) => (
              <option key={l} value={l}>{challengeFor(l, mode).label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setPhase('intro')} className="mt-5 w-full rounded-xl bg-cyan-300 px-5 py-3 font-bold text-[#0b1120] hover:bg-cyan-200">Play preview</button>
      </div>
    </div>
  );
}
