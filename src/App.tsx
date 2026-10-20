import { useState, useCallback, useEffect } from 'react';
import { StartScreen } from '@/components/StartScreen';
import { GameScreen } from '@/components/GameScreen';
import { WinScreen } from '@/components/WinScreen';
import { OpacityScreen } from '@/components/OpacityScreen';
import { useGameEngine } from '@/useGameEngine';
import { usePoster } from '@/usePoster';
import { CELEBRATION_MS, prefersReducedMotion } from '@/celebration';
import type { GameConfig, GameState } from '@/types';

/**
 * 'celebrating' is the beat between the last tile landing and the win screen:
 * the board heals and lifts while the poster renders in the background.
 */
type Phase = 'start' | 'playing' | 'celebrating' | 'won';

/**
 * The game is a state machine rather than a set of pages, so the only real
 * route is the /opacity tuning page. A pathname check keeps that one extra
 * screen from pulling in a router.
 */
function usePathname(): string {
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  );

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return pathname;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function App() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>('start');
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [completedState, setCompletedState] = useState<GameState | null>(null);

  const engine = useGameEngine(phase === 'playing' || phase === 'celebrating' ? config : null);

  const finishedState = completedState ?? engine.state;

  // Start rendering the poster as soon as the board is finished, so the
  // celebration covers the work instead of the player waiting on a placeholder.
  const poster = usePoster(
    config,
    formatTime(finishedState.elapsed),
    phase === 'celebrating' || phase === 'won',
  );

  const handleStart = useCallback((cfg: GameConfig) => {
    setCompletedState(null);
    setConfig(cfg);
    setPhase('playing');
  }, []);

  const handleHome = useCallback(() => {
    setCompletedState(null);
    setPhase('start');
    setConfig(null);
  }, []);

  const handleReset = useCallback(() => {
    engine.reset();
  }, [engine]);

  // Auto-detect win — must be in an effect, not during render
  useEffect(() => {
    if (phase === 'playing' && engine.state.won) {
      setCompletedState(engine.state);
      setPhase('celebrating');
    }
  }, [phase, engine.state]);

  // Hand over to the win screen once the board has finished its sequence.
  useEffect(() => {
    if (phase !== 'celebrating') return;
    const timer = window.setTimeout(
      () => setPhase('won'),
      prefersReducedMotion() ? 0 : CELEBRATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (pathname.replace(/\/+$/, '') === '/opacity') {
    return <OpacityScreen />;
  }

  if (phase === 'start' || !config) {
    return <StartScreen onStart={handleStart} />;
  }

  if (phase === 'won') {
    return <WinScreen state={finishedState} poster={poster} />;
  }

  // Don't render GameScreen until the engine has initialized the board
  if (engine.state.board.length === 0) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center">
        <div className="brand-backdrop" aria-hidden="true" />
        <div className="relative z-10 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-brand-blue/20 border-t-brand-blue" />
          <p className="text-sm text-brand-muted">Preparing puzzle...</p>
        </div>
      </div>
    );
  }

  return (
    <GameScreen
      config={config}
      state={engine.state}
      celebrating={phase === 'celebrating'}
      onMoveLeft={engine.moveLeft}
      onMoveRight={engine.moveRight}
      onMoveDown={engine.moveDown}
      onHardDrop={engine.hardDrop}
      onResume={engine.resume}
      onReset={handleReset}
      onHome={handleHome}
    />
  );
}

export default App;
