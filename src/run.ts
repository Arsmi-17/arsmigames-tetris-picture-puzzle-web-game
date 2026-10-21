import { CHAPTER_LENGTH, RUN_VERSION, type Challenge, type PersonalBests, type Picture, type RoundResult, type Run, type RunMode } from './model';
import { MODES, challengeFor, clampLevel } from './challenge';
import { randomId, randomSeed, shuffle, type Rng } from './random';
import { readStorage, removeStorage, writeStorage } from './storage';

/**
 * Endless run rules: chapter pacing, picture selection and the difficulty
 * director. Pure functions over the Run record; React only stores the result.
 */

/**
 * Level offset from the chapter's base for each stage: a familiar start,
 * two small steps, one peak, then a lighter round before the recap.
 */
export const STAGE_OFFSETS = [0, 1, 1, 2, 0] as const;

/** How many results the director looks back over. */
const RECENT_LIMIT = 5;
/** How many finished picture ids to keep in the saved run. */
const COMPLETED_LIMIT = 50;

export type RoundFeel = 'comfortable' | 'ok' | 'struggling';

/** Rough time a player needs for a round, used only to judge comfort. */
export function targetSeconds(challenge: Challenge): number {
  const pieces = (challenge.cols * challenge.rows) / 4;
  return Math.round(pieces * Math.max(4, (challenge.fallMs / 1000) * 2));
}

export function assessRound(result: RoundResult, challenge: Challenge): RoundFeel {
  const target = targetSeconds(challenge);
  if (result.mistakes >= Math.max(3, Math.ceil(result.pieces / 5)) || result.seconds > target * 2) return 'struggling';
  if (result.mistakes <= Math.max(1, Math.floor(result.pieces / 16)) && result.hints === 0 && result.seconds <= target) return 'comfortable';
  return 'ok';
}

/** The run's pace: Arcade falls a little faster each chapter, within a floor. */
export function runChallenge(level: number, mode: RunMode, chapter: number): Challenge {
  const base = challengeFor(level, mode);
  if (mode !== 'arcade') return base;
  const speedUp = Math.max(0.75, 1 - 0.04 * (chapter - 1));
  return { ...base, fallMs: Math.round(base.fallMs * speedUp) };
}

/** Recent results judged against the challenge they were played at. */
function feels(results: RoundResult[], mode: RunMode, chapter: number): RoundFeel[] {
  return results.map((r) => assessRound(r, runChallenge(r.level, mode, chapter)));
}

/**
 * Level for a stage. Two struggling rounds in a row ease the next picture by
 * one step; otherwise follow the chapter's pacing.
 */
export function stageLevel(run: Pick<Run, 'chapterBase' | 'stage' | 'mode' | 'recent' | 'chapter'>): number {
  let level = run.chapterBase + STAGE_OFFSETS[run.stage];
  const lastTwo = feels(run.recent.slice(-2), run.mode, run.chapter);
  if (lastTwo.length === 2 && lastTwo.every((f) => f === 'struggling')) level -= 1;
  return clampLevel(level, run.mode);
}

/**
 * Next chapter's starting level, moving by at most one step: up after
 * repeated comfortable pictures, down after repeated struggles.
 */
export function nextChapterBase(run: Pick<Run, 'chapterBase' | 'chapterResults' | 'mode' | 'chapter'>): number {
  const results = feels(run.chapterResults, run.mode, run.chapter);
  const comfortable = results.filter((f) => f === 'comfortable').length;
  const struggling = results.filter((f) => f === 'struggling').length;
  let base = run.chapterBase;
  if (struggling >= 2) base -= 1;
  else if (comfortable >= 3) base += 1;
  // Keep room for the chapter's peak inside the mode's bounds.
  const { minLevel, maxLevel } = MODES[run.mode];
  const peak = Math.max(...STAGE_OFFSETS);
  return Math.min(Math.max(minLevel, maxLevel - peak), Math.max(minLevel, base));
}

/**
 * Draw the next picture from the shuffled bag. Prefers pictures whose
 * intended range includes the level, never repeats the previous picture when
 * another exists, and reshuffles a fresh bag when this one runs out.
 */
export function drawPicture(
  bag: string[],
  pictures: Picture[],
  level: number,
  previousId: string | null,
  rng: Rng = Math.random,
): { pictureId: string; bag: string[] } {
  const byId = new Map(pictures.map((p) => [p.id, p]));
  let remaining = bag.filter((id) => byId.has(id));
  if (remaining.length === 0) remaining = shuffle(pictures.map((p) => p.id), rng);

  const allowed = (id: string) => id !== previousId || pictures.length === 1;
  const inRange = (id: string) => {
    const p = byId.get(id)!;
    return level >= p.minChallenge && level <= p.maxChallenge;
  };

  let index = remaining.findIndex((id) => allowed(id) && inRange(id));
  if (index < 0) index = remaining.findIndex(allowed);
  if (index < 0) {
    // Only the previous picture is left in this bag: start a new bag instead.
    remaining = shuffle(pictures.map((p) => p.id), rng);
    index = remaining.findIndex((id) => allowed(id) && inRange(id));
    if (index < 0) index = remaining.findIndex(allowed);
  }
  const pictureId = remaining[index];
  return { pictureId, bag: remaining.filter((_, i) => i !== index) };
}

export function createRun(mode: RunMode, pictures: Picture[], rng: Rng = Math.random): Run {
  const chapterBase = MODES[mode].minLevel;
  const level = clampLevel(chapterBase + STAGE_OFFSETS[0], mode);
  const draw = drawPicture([], pictures, level, null, rng);
  return {
    version: RUN_VERSION,
    runId: randomId(),
    mode,
    chapter: 1,
    stage: 0,
    chapterBase,
    challengeLevel: level,
    pictureId: draw.pictureId,
    puzzleSeed: randomSeed(),
    score: 0,
    streak: 0,
    picturesCompleted: 0,
    completedPictureIds: [],
    bag: draw.bag,
    mistakesLeft: Number.isFinite(MODES[mode].mistakeBudget) ? MODES[mode].mistakeBudget : 0,
    recent: [],
    chapterResults: [],
    startedAt: Date.now(),
    ended: false,
  };
}

/** Points the run gains for a finished picture. */
export function roundBonus(run: Run, result: RoundResult): number {
  if (run.mode !== 'arcade') return 0;
  const clean = result.mistakes === 0 ? 2 : 1;
  return 50 * (result.level + 1) * clean;
}

export interface RoundOutcome {
  run: Run;
  /** The chapter just finished; show the recap before continuing. */
  chapterComplete: boolean;
  /** Results of the finished chapter, for the recap. */
  chapterResults: RoundResult[];
  bonus: number;
}

/** Record a finished picture and set up the next one. */
export function completeRound(run: Run, result: RoundResult, pictures: Picture[], rng: Rng = Math.random): RoundOutcome {
  const bonus = roundBonus(run, result);
  const chapterResults = [...run.chapterResults, result];
  const chapterComplete = run.stage + 1 >= CHAPTER_LENGTH;
  const next: Run = {
    ...run,
    score: run.score + result.score + bonus,
    streak: result.mistakes === 0 ? run.streak + 1 : 0,
    picturesCompleted: run.picturesCompleted + 1,
    completedPictureIds: [...run.completedPictureIds, result.pictureId].slice(-COMPLETED_LIMIT),
    recent: [...run.recent, result].slice(-RECENT_LIMIT),
    chapterResults,
  };

  if (chapterComplete) {
    next.chapterBase = nextChapterBase({ ...next, chapterResults });
    next.chapter = run.chapter + 1;
    next.stage = 0;
    next.chapterResults = [];
    // A finished chapter restores one Arcade miss.
    if (run.mode === 'arcade') next.mistakesLeft = Math.min(MODES.arcade.mistakeBudget, run.mistakesLeft + 1);
  } else {
    next.stage = run.stage + 1;
  }

  next.challengeLevel = stageLevel(next);
  const draw = drawPicture(run.bag, pictures, next.challengeLevel, result.pictureId, rng);
  next.pictureId = draw.pictureId;
  next.bag = draw.bag;
  next.puzzleSeed = randomSeed();
  return { run: next, chapterComplete, chapterResults, bonus };
}

/** Swap the current picture (it failed to load, or left the catalog). */
export function replacePicture(run: Run, pictures: Picture[], rng: Rng = Math.random): Run {
  const draw = drawPicture(run.bag, pictures, run.challengeLevel, run.pictureId, rng);
  return { ...run, pictureId: draw.pictureId, bag: draw.bag, puzzleSeed: randomSeed() };
}

/** An incorrect drop in Arcade spends one miss; the run ends at zero. */
export function recordMistake(run: Run): Run {
  if (run.mode !== 'arcade' || run.ended) return run;
  const mistakesLeft = Math.max(0, run.mistakesLeft - 1);
  return { ...run, mistakesLeft, streak: 0, ended: mistakesLeft === 0 };
}

export function endRun(run: Run): Run {
  return { ...run, ended: true };
}

// ---- Local persistence (this device and browser only) ----

const RUN_KEY = 'shape-reveal:run:v1';
const BESTS_KEY = 'shape-reveal:bests:v1';

function isRoundResult(value: unknown): value is RoundResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.pictureId === 'string' && ['level', 'pieces', 'seconds', 'mistakes', 'hints', 'score'].every((k) => typeof r[k] === 'number');
}

/** Validate a saved run; anything unexpected is discarded rather than trusted. */
export function parseRun(value: unknown): Run | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const numbers = ['chapter', 'stage', 'chapterBase', 'challengeLevel', 'puzzleSeed', 'score', 'streak', 'picturesCompleted', 'mistakesLeft', 'startedAt'];
  if (r.version !== RUN_VERSION || (r.mode !== 'relaxed' && r.mode !== 'arcade')) return null;
  if (typeof r.runId !== 'string' || typeof r.pictureId !== 'string' || typeof r.ended !== 'boolean') return null;
  if (!numbers.every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]))) return null;
  if (![r.completedPictureIds, r.bag].every((a) => Array.isArray(a) && a.every((id) => typeof id === 'string'))) return null;
  if (![r.recent, r.chapterResults].every((a) => Array.isArray(a) && a.every(isRoundResult))) return null;
  const run = value as Run;
  if (run.stage < 0 || run.stage >= CHAPTER_LENGTH || run.chapter < 1) return null;
  return { ...run, challengeLevel: clampLevel(run.challengeLevel, run.mode), chapterBase: clampLevel(run.chapterBase, run.mode) };
}

export function loadSavedRun(): Run | null {
  const run = parseRun(readStorage(RUN_KEY));
  return run && !run.ended ? run : null;
}

export function saveRun(run: Run): void {
  if (run.ended) removeStorage(RUN_KEY);
  else writeStorage(RUN_KEY, run);
}

export function clearSavedRun(): void {
  removeStorage(RUN_KEY);
}

export const EMPTY_BESTS: PersonalBests = {
  relaxed: { pictures: 0, chapters: 0 },
  arcade: { score: 0, pictures: 0 },
};

export function loadBests(): PersonalBests {
  const raw = readStorage(BESTS_KEY) as Partial<PersonalBests> | null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    relaxed: { pictures: num(raw?.relaxed?.pictures), chapters: num(raw?.relaxed?.chapters) },
    arcade: { score: num(raw?.arcade?.score), pictures: num(raw?.arcade?.pictures) },
  };
}

/** Merge a run into the bests. Returns the new bests and what improved. */
export function updateBests(bests: PersonalBests, run: Run): { bests: PersonalBests; improved: string[] } {
  const chapters = run.chapter - 1;
  const improved: string[] = [];
  const next: PersonalBests = { relaxed: { ...bests.relaxed }, arcade: { ...bests.arcade } };
  if (run.mode === 'relaxed') {
    if (run.picturesCompleted > next.relaxed.pictures) { next.relaxed.pictures = run.picturesCompleted; improved.push('pictures'); }
    if (chapters > next.relaxed.chapters) { next.relaxed.chapters = chapters; improved.push('chapters'); }
  } else {
    if (run.score > next.arcade.score) { next.arcade.score = run.score; improved.push('score'); }
    if (run.picturesCompleted > next.arcade.pictures) { next.arcade.pictures = run.picturesCompleted; improved.push('pictures'); }
  }
  return { bests: next, improved };
}

export function saveBests(bests: PersonalBests): void {
  writeStorage(BESTS_KEY, bests);
}
