import { useCallback, useEffect, useState } from 'react';
import { StartScreen } from '@/components/StartScreen';
import { GameScreen } from '@/components/GameScreen';
import { WinScreen } from '@/components/WinScreen';
import { useGameEngine } from '@/useGameEngine';
import { CELEBRATION_MS, prefersReducedMotion } from '@/celebration';
import type { GameConfig, GameState } from '@/types';

type Phase = 'start' | 'playing' | 'celebrating' | 'won';

function App() {
  const [phase, setPhase] = useState<Phase>('start');
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [completedState, setCompletedState] = useState<GameState | null>(null);
  const engine = useGameEngine(phase === 'playing' || phase === 'celebrating' ? config : null);

  const handleStart = useCallback((nextConfig: GameConfig) => {
    setCompletedState(null);
    setConfig(nextConfig);
    setPhase('playing');
  }, []);

  const handleHome = useCallback(() => {
    setCompletedState(null);
    setConfig(null);
    setPhase('start');
  }, []);

  const handleReplay = useCallback(() => {
    setCompletedState(null);
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

  if (phase === 'start' || !config) return <StartScreen onStart={handleStart} />;
  if (phase === 'won') return <WinScreen config={config} state={completedState ?? engine.state} onReplay={handleReplay} onHome={handleHome} />;
  if (engine.state.board.length === 0) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#0b1120] text-slate-300">Preparing puzzle…</div>;
  }

  return <GameScreen
    config={config}
    state={engine.state}
    celebrating={phase === 'celebrating'}
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
