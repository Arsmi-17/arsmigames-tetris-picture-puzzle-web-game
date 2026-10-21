import type { Challenge, Mode, RoundRules, RunMode } from './model';

/**
 * Tested difficulty ladder. Each step changes one pressure at a time: either
 * the board grows or the fall speeds up. Every board size here is covered by
 * the puzzle and retry-queue tests (tests/puzzles.test.ts, tests/engine.test.ts);
 * add a size there before adding it here.
 */
export const CHALLENGE_LADDER: Challenge[] = [
  { level: 0, label: '4×4 · Gentle', cols: 4, rows: 4, fallMs: 3000, previewMs: 2500 },
  { level: 1, label: '4×4 · Brisk', cols: 4, rows: 4, fallMs: 2000, previewMs: 2000 },
  { level: 2, label: '6×6 · Steady', cols: 6, rows: 6, fallMs: 2400, previewMs: 2500 },
  { level: 3, label: '6×6 · Brisk', cols: 6, rows: 6, fallMs: 1800, previewMs: 2000 },
  { level: 4, label: '8×8 · Steady', cols: 8, rows: 8, fallMs: 2200, previewMs: 2500 },
  { level: 5, label: '8×8 · Brisk', cols: 8, rows: 8, fallMs: 1600, previewMs: 2000 },
  { level: 6, label: '10×10 · Steady', cols: 10, rows: 10, fallMs: 1500, previewMs: 2500 },
  { level: 7, label: '10×10 · Fast', cols: 10, rows: 10, fallMs: 1100, previewMs: 2000 },
];

export const MAX_CHALLENGE = CHALLENGE_LADDER.length - 1;

/** Board sizes playable in Free play; same tested sizes as the ladder. */
export const FREE_PLAY_SIZES: Challenge[] = [
  { level: 0, label: 'Easy · 4×4', cols: 4, rows: 4, fallMs: 3000, previewMs: 0 },
  { level: 2, label: 'Gentle · 6×6', cols: 6, rows: 6, fallMs: 2600, previewMs: 0 },
  { level: 4, label: 'Medium · 8×8', cols: 8, rows: 8, fallMs: 2200, previewMs: 0 },
  { level: 6, label: 'Hard · 10×10', cols: 10, rows: 10, fallMs: 1250, previewMs: 0 },
];

export interface ModeSettings {
  label: string;
  description: string;
  /** Inclusive ladder bounds the director stays within. */
  minLevel: number;
  maxLevel: number;
  /** Multiplier on the ladder's fall interval (> 1 is slower). */
  fallScale: number;
  rules: RoundRules;
  /** Arcade: incorrect drops allowed across the run. */
  mistakeBudget: number;
}

export const MODES: Record<RunMode, ModeSettings> = {
  relaxed: {
    label: 'Relaxed',
    description: 'Unhurried pictures with a landing guide. Mistakes simply retry.',
    minLevel: 0,
    maxLevel: 6,
    fallScale: 1.5,
    rules: { wrongPenalty: 0, hintCost: 0, landingPreview: true },
    mistakeBudget: Infinity,
  },
  arcade: {
    label: 'Arcade',
    description: 'Faster falls and a score to beat. Five misses end the run.',
    minLevel: 1,
    maxLevel: MAX_CHALLENGE,
    fallScale: 1,
    rules: { wrongPenalty: 25, hintCost: 40, landingPreview: false },
    mistakeBudget: 5,
  },
};

/** Free play keeps the prototype's original scoring. */
export const FREE_PLAY_RULES: RoundRules = { wrongPenalty: 25, hintCost: 0, landingPreview: false };

export function clampLevel(level: number, mode: RunMode): number {
  const { minLevel, maxLevel } = MODES[mode];
  return Math.min(maxLevel, Math.max(minLevel, Math.round(level)));
}

/** The challenge for a ladder level, adjusted for the mode's pace. */
export function challengeFor(level: number, mode: Mode): Challenge {
  const step = CHALLENGE_LADDER[Math.min(MAX_CHALLENGE, Math.max(0, level))];
  if (mode === 'free') return step;
  return { ...step, fallMs: Math.round(step.fallMs * MODES[mode].fallScale) };
}

export function rulesFor(mode: Mode): RoundRules {
  return mode === 'free' ? FREE_PLAY_RULES : MODES[mode].rules;
}
