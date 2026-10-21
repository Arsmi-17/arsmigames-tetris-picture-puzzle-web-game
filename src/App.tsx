import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { StartScreen } from '@/components/StartScreen';
import { GameScreen } from '@/components/GameScreen';
import { WinScreen } from '@/components/WinScreen';
import { RoundIntro } from '@/components/RoundIntro';
import { useGameEngine } from '@/useGameEngine';
import { CELEBRATION_MS, prefersReducedMotion } from '@/celebration';
import { rulesFor } from '@/challenge';
import { SAMPLE_PICTURES } from '@/pictures';
import { randomSeed } from '@/random';
import type { Challenge, Picture } from '@/model';
import type { GameConfig, GameState } from '@/types';

type Phase = 'start' | 'intro' | 'playing' | 'celebrating' | 'won';

function App() {
  const [phase, setPhase] = useState<Phase>('start');
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [exportable, setExportable] = useState(true);
  const [completedState, setCompletedState] = useState<GameState | null>(null);
  const engine = useGameEngine(phase === 'playing' || phase === 'celebrating' ? config : null);

  const handleStart = useCallback((picture: Picture, challenge: Challenge) => {
    setCompletedState(null);
    setConfig({ picture, challenge, rules: rulesFor('free'), seed: randomSeed() });
    setPhase('intro');
  }, []);

  const handleReady = useCallback((canExport: boolean) => {
    setExportable(canExport);
    setPhase('playing');
  }, []);

  const handleHome = useCallback(() => {
    setCompletedState(null);
    setConfig(null);
    setPhase('start');
  }, []);

  const handleReplay = useCallback(() => {
    setCompletedState(null);
    setConfig((current) => (current ? { ...current, seed: randomSeed() } : current));
    setPhase('playing');
  }, []);

  useEffect(() => {
    if (phase === 'playing' && engine.state.won) {
      setCompletedState(engine.state);
      setPhase('celebrating');
    }
  }, [phase, engine.state]);

  useEffect(() => {
    if (phase !== 'celebrating') return;
    const timer = window.setTimeout(() => setPhase('won'), prefersReducedMotion() ? 0 : CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'start' || !config) return <StartScreen pictures={SAMPLE_PICTURES} onStart={handleStart} />;
  if (phase === 'intro') {
    return <RoundIntro picture={config.picture} challenge={config.challenge} onStart={handleReady} onBack={handleHome} />;
  }
  if (phase === 'won') {
    return <WinScreen
      config={config}
      state={completedState ?? engine.state}
      exportable={exportable}
      primary={{ label: 'Play again', onClick: handleReplay, icon: <RotateCcw className="h-5 w-5" /> }}
      secondary={[{ label: 'New picture', onClick: handleHome }]}
    />;
  }
  if (engine.state.board.length === 0) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#0b1120] text-slate-300">Preparing puzzle…</div>;
  }

  return <GameScreen
    config={config}
    state={engine.state}
    celebrating={phase === 'celebrating'}
    onToggleHint={engine.toggleHint}
    onMoveLeft={engine.moveLeft}
    onMoveRight={engine.moveRight}
    onMoveDown={engine.moveDown}
    onHardDrop={engine.hardDrop}
    onPause={engine.pause}
    onResume={engine.resume}
    onReset={engine.reset}
    onHome={handleHome}
  />;
}

export default App;
