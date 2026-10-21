/**
 * Shape Reveal domain model.
 *
 * - Picture: one curated image from the catalog (or the player's own file).
 * - Mode: how a session is played — an endless Relaxed or Arcade run, or a
 *   single Free play round with a chosen picture and size.
 * - Challenge: one tested step on the difficulty ladder (board size, fall
 *   speed, preview time). Only board sizes covered by the puzzle verifier
 *   appear on the ladder.
 * - Run: the versioned, locally saved progress of an endless run. It holds
 *   the current picture and puzzle seed so a refresh rebuilds the same round.
 */

/** A picture the game can be played with. Mirrors the public catalog entry. */
export interface Picture {
  /** Stable catalog identifier; used in analytics instead of the URL. */
  id: string;
  title: string;
  /** Theme pack name, e.g. "Calm", "Bright". */
  theme: string;
  /** Full-size, square-friendly image URL. */
  url: string;
  /** Small preview for menus; falls back to `url`. */
  thumbUrl?: string;
  /** Text alternative describing the picture. */
  alt: string;
  /** Credit line shown with the picture, e.g. "Photo by …". */
  attribution?: string;
  license?: string;
  /** Intended challenge range (inclusive ladder levels). */
  minChallenge: number;
  maxChallenge: number;
}

export type Mode = 'relaxed' | 'arcade' | 'free';
export type RunMode = Exclude<Mode, 'free'>;

/** One step on the challenge ladder. */
export interface Challenge {
  /** Ladder index, 0 = gentlest. */
  level: number;
  /** Short label shown to the player, e.g. "8×8 · Steady". */
  label: string;
  cols: number;
  rows: number;
  /** Milliseconds between automatic one-row falls. */
  fallMs: number;
  /** How long the round preview shows the picture before play starts. */
  previewMs: number;
}

/** Scoring and assistance for a single round, derived from the mode. */
export interface RoundRules {
  /** Points removed for an incorrect drop. */
  wrongPenalty: number;
  /** Points removed each time a piece is hinted. */
  hintCost: number;
  /** Shows where the falling piece will land. */
  landingPreview: boolean;
}

/** What happened in one completed picture; drives the difficulty director. */
export interface RoundResult {
  pictureId: string;
  level: number;
  pieces: number;
  seconds: number;
  mistakes: number;
  hints: number;
  score: number;
}

export const RUN_VERSION = 1;
export const CHAPTER_LENGTH = 5;

export interface Run {
  version: typeof RUN_VERSION;
  /** Anonymous, random identifier. Never linked to a person. */
  runId: string;
  mode: RunMode;
  /** 1-based chapter number. */
  chapter: number;
  /** 0-based picture index inside the chapter, < CHAPTER_LENGTH. */
  stage: number;
  /** Chapter starting level chosen by the difficulty director. */
  chapterBase: number;
  /** Ladder level for the current picture. */
  challengeLevel: number;
  /** Picture for the current (or next) round. */
  pictureId: string;
  /** Seed for the current round's partition and queue. */
  puzzleSeed: number;
  score: number;
  /** Consecutive pictures completed without an incorrect drop. */
  streak: number;
  /** Total pictures finished in this run. */
  picturesCompleted: number;
  /** Most recent finished picture ids, newest last (bounded). */
  completedPictureIds: string[];
  /** Picture ids still to draw before the bag reshuffles. */
  bag: string[];
  /** Arcade only: incorrect drops left before the run ends. */
  mistakesLeft: number;
  /** Last few results, newest last, for the difficulty director. */
  recent: RoundResult[];
  /** Results in the current chapter, for the recap. */
  chapterResults: RoundResult[];
  startedAt: number;
  ended: boolean;
}

/** Personal bests, kept per mode on this device only. */
export interface PersonalBests {
  relaxed: { pictures: number; chapters: number };
  arcade: { score: number; pictures: number };
}
