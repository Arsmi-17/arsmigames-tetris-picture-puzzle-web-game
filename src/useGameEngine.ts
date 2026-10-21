import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, GameConfig } from './types';
import * as engine from './engine';

/** How long a rejected piece blinks before the retry spawns. Matches .animate-blink-out. */
export const REJECT_FLASH_MS = 900;

export interface GameEngine {
  state: GameState;
  moveLeft: () => void;
  moveRight: () => void;
  moveDown: () => void;
  hardDrop: () => void;
  toggleHint: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

/**
 * Drives a round in real time: gravity, the clock, keyboard input and the
 * wrong-drop pause. All rule changes go through the pure functions in engine.ts.
 */
export function useGameEngine(config: GameConfig | null): GameEngine {
  const [state, setState] = useState<GameState | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const configRef = useRef<GameConfig | null>(config);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    configRef.current = config;
    setState(config ? engine.createGame(config.challenge, config.seed) : null);
  }, [config]);

  /** Apply a pure engine step using the current board size and rules. */
  const apply = useCallback((step: (s: GameState, c: GameConfig) => GameState) => {
    setState((prev) => {
      const current = configRef.current;
      return prev && current ? step(prev, current) : prev;
    });
  }, []);

  const moveLeft = useCallback(() => apply((s, c) => engine.moveHorizontal(s, c.challenge, -1)), [apply]);
  const moveRight = useCallback(() => apply((s, c) => engine.moveHorizontal(s, c.challenge, 1)), [apply]);
  const moveDown = useCallback(() => apply((s, c) => engine.moveDown(s, c.challenge, c.rules)), [apply]);
  const hardDrop = useCallback(() => apply((s, c) => engine.hardDrop(s, c.challenge, c.rules)), [apply]);
  const toggleHint = useCallback(() => apply((s, c) => engine.toggleHint(s, c.rules)), [apply]);
  const pause = useCallback(() => apply((s) => engine.setPaused(s, true)), [apply]);
  const resume = useCallback(() => apply((s) => engine.setPaused(s, false)), [apply]);
  const reset = useCallback(() => {
    const current = configRef.current;
    if (current) setState(engine.createGame(current.challenge, current.seed));
  }, []);

  const hasGame = state !== null;
  const paused = state?.paused ?? false;
  const won = state?.won ?? false;
  const rejecting = state?.rejectedPiece !== null && state?.rejectedPiece !== undefined;
  const currentPieceId = state?.currentPiece?.id ?? null;

  // Let a rejected piece blink out, then continue with the planned queue.
  // Pausing during the blink holds the retry until play resumes.
  useEffect(() => {
    if (!rejecting || paused) return;
    const timer = window.setTimeout(
      () => apply((s, c) => engine.finishRejection(s, c.challenge, c.rules)),
      REJECT_FLASH_MS,
    );
    return () => window.clearTimeout(timer);
  }, [rejecting, paused, apply]);

  // Gravity
  useEffect(() => {
    if (!hasGame || paused || won || currentPieceId === null) return;
    const speed = configRef.current?.challenge.fallMs ?? 1000;
    const timer = window.setInterval(moveDown, speed);
    return () => window.clearInterval(timer);
  }, [hasGame, paused, won, currentPieceId, moveDown]);

  // Clock
  useEffect(() => {
    if (!hasGame || paused || won) return;
    const timer = window.setInterval(() => apply((s) => engine.tick(s)), 1000);
    return () => window.clearInterval(timer);
  }, [hasGame, paused, won, apply]);

  // Keyboard input
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const current = stateRef.current;
      if (!current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;

      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        if (current.paused) resume();
        else pause();
        return;
      }
      if (current.paused || current.won) return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          moveLeft();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          moveRight();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          moveDown();
          break;
        case ' ':
          // Space on a focused button would also click it; the drop replaces that.
          e.preventDefault();
          hardDrop();
          break;
        case 'h':
        case 'H':
          toggleHint();
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [moveLeft, moveRight, moveDown, hardDrop, toggleHint, pause, resume]);

  return {
    state: state ?? engine.emptyGame(),
    moveLeft,
    moveRight,
    moveDown,
    hardDrop,
    toggleHint,
    pause,
    resume,
    reset,
  };
}
