// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as runs from '@/run';
import { CHALLENGE_LADDER, MODES, MAX_CHALLENGE } from '@/challenge';
import { CHAPTER_LENGTH, type Picture, type RoundResult, type Run, type RunMode } from '@/model';
import { createRng } from '@/random';

const picture = (id: string, min = 0, max = MAX_CHALLENGE): Picture => ({
  id, title: id, theme: 'T', url: `https://images.example.com/${id}.png`, alt: id, minChallenge: min, maxChallenge: max,
});
const library = (n: number) => Array.from({ length: n }, (_, i) => picture(`p${i}`));

function result(run: Run, feel: 'easy' | 'hard' | 'mid' = 'mid'): RoundResult {
  const c = runs.runChallenge(run.challengeLevel, run.mode, run.chapter);
  const pieces = (c.cols * c.rows) / 4;
  const target = runs.targetSeconds(c);
  return {
    pictureId: run.pictureId,
    level: run.challengeLevel,
    pieces,
    seconds: feel === 'easy' ? Math.floor(target / 2) : feel === 'hard' ? target * 3 : target + 1,
    mistakes: feel === 'hard' ? 10 : feel === 'easy' ? 0 : 2,
    hints: feel === 'easy' ? 0 : 1,
    score: pieces * 100,
  };
}

function play(mode: RunMode, rounds: number, feel: (i: number) => 'easy' | 'hard' | 'mid', pictures = library(8), seed = 1) {
  const rng = createRng(seed);
  let run = runs.createRun(mode, pictures, rng);
  const history: Run[] = [run];
  const outcomes: runs.RoundOutcome[] = [];
  for (let i = 0; i < rounds; i += 1) {
    const outcome = runs.completeRound(run, result(run, feel(i)), pictures, rng);
    outcomes.push(outcome);
    run = outcome.run;
    history.push(run);
  }
  return { run, history, outcomes };
}

beforeEach(() => localStorage.clear());

describe('picture bag', () => {
  for (const size of [2, 3, 5, 12]) {
    it(`${size} pictures: no immediate repeats and every bag covers the library`, () => {
      const pictures = library(size);
      const rng = createRng(size);
      let bag: string[] = [];
      let previous: string | null = null;
      const drawn: string[] = [];
      for (let i = 0; i < size * 60; i += 1) {
        const draw = runs.drawPicture(bag, pictures, 3, previous, rng);
        expect(draw.pictureId).not.toBe(previous);
        drawn.push(draw.pictureId);
        previous = draw.pictureId;
        bag = draw.bag;
      }
      // The first full bag is a permutation of the library.
      expect(new Set(drawn.slice(0, size)).size).toBe(size);
      // Over many bags every picture appears about equally often.
      const counts = pictures.map((p) => drawn.filter((id) => id === p.id).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(Math.ceil(size * 60 * 0.1) + 2);
    });
  }

  it('a single picture library still works', () => {
    const draw = runs.drawPicture([], library(1), 0, 'p0');
    expect(draw.pictureId).toBe('p0');
  });

  it('prefers pictures intended for the level', () => {
    const pictures = [picture('easy', 0, 1), picture('hard', 5, 7), picture('any')];
    const draw = runs.drawPicture(['easy', 'hard', 'any'], pictures, 6, null);
    expect(draw.pictureId).toBe('hard');
  });

  it('drops pictures that left the catalog from the bag', () => {
    const draw = runs.drawPicture(['gone', 'p1'], library(2), 0, null);
    expect(draw.pictureId).toBe('p1');
  });
});

describe('chapters and pacing', () => {
  it('advances through five-picture chapters without returning to setup', () => {
    const { history, outcomes } = play('relaxed', CHAPTER_LENGTH * 3, () => 'mid');
    expect(outcomes.map((o) => o.chapterComplete)).toEqual(
      Array.from({ length: 15 }, (_, i) => (i + 1) % CHAPTER_LENGTH === 0),
    );
    expect(history.at(-1)!.chapter).toBe(4);
    expect(history.at(-1)!.stage).toBe(0);
    expect(history.at(-1)!.picturesCompleted).toBe(15);
    expect(outcomes[4].chapterResults).toHaveLength(5);
    for (let i = 1; i < history.length; i += 1) expect(history[i].pictureId).not.toBe(history[i - 1].pictureId);
  });

  it('follows familiar → steps → peak → lighter within a chapter', () => {
    const { history } = play('relaxed', CHAPTER_LENGTH, () => 'mid');
    const base = history[0].chapterBase;
    expect(history.slice(0, 5).map((r) => r.challengeLevel - base)).toEqual([...runs.STAGE_OFFSETS]);
  });

  it('steps up after comfortable chapters, but never past the mode bounds', () => {
    for (const mode of ['relaxed', 'arcade'] as const) {
      const { history } = play(mode, 60, () => 'easy');
      const bases = history.map((r) => r.chapterBase);
      for (let i = 1; i < bases.length; i += 1) expect(Math.abs(bases[i] - bases[i - 1])).toBeLessThanOrEqual(1);
      expect(Math.max(...bases)).toBeGreaterThan(MODES[mode].minLevel);
      for (const r of history) {
        expect(r.challengeLevel).toBeGreaterThanOrEqual(MODES[mode].minLevel);
        expect(r.challengeLevel).toBeLessThanOrEqual(MODES[mode].maxLevel);
      }
      expect(Math.max(...history.map((r) => r.challengeLevel))).toBe(MODES[mode].maxLevel);
    }
  });

  it('steps down and eases the next picture when the player struggles', () => {
    const climbed = play('arcade', 20, () => 'easy');
    let run = climbed.run;
    const startBase = run.chapterBase;
    const rng = createRng(3);
    const pictures = library(8);
    const levels: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const expected = run.chapterBase + runs.STAGE_OFFSETS[run.stage];
      levels.push(run.challengeLevel - Math.min(expected, MODES.arcade.maxLevel));
      run = runs.completeRound(run, result(run, 'hard'), pictures, rng).run;
    }
    expect(run.chapterBase).toBeLessThan(startBase);
    expect(levels.slice(2).some((delta) => delta < 0)).toBe(true);
  });

  it('only ever uses board sizes on the tested ladder', () => {
    const tested = new Set(CHALLENGE_LADDER.map((c) => `${c.cols}x${c.rows}`));
    const { history } = play('arcade', 80, (i) => (i % 3 === 0 ? 'hard' : 'easy'));
    for (const r of history) {
      const c = runs.runChallenge(r.challengeLevel, r.mode, r.chapter);
      expect(tested.has(`${c.cols}x${c.rows}`)).toBe(true);
      expect(c.fallMs).toBeGreaterThanOrEqual(800);
    }
  });

  it('Arcade gets faster by chapter, down to a floor', () => {
    const one = runs.runChallenge(4, 'arcade', 1).fallMs;
    const three = runs.runChallenge(4, 'arcade', 3).fallMs;
    expect(three).toBeLessThan(one);
    expect(runs.runChallenge(4, 'arcade', 50).fallMs).toBe(Math.round(CHALLENGE_LADDER[4].fallMs * 0.75));
    expect(runs.runChallenge(4, 'relaxed', 9).fallMs).toBe(runs.runChallenge(4, 'relaxed', 1).fallMs);
  });
});

describe('Arcade misses', () => {
  it('each miss spends the budget, the run ends at zero, and chapters restore one', () => {
    let run = runs.createRun('arcade', library(4));
    expect(run.mistakesLeft).toBe(5);
    for (let i = 0; i < 4; i += 1) run = runs.recordMistake(run);
    expect(run.mistakesLeft).toBe(1);
    expect(run.ended).toBe(false);
    const ended = runs.recordMistake(run);
    expect(ended.ended).toBe(true);
    expect(runs.recordMistake(ended)).toBe(ended);

    for (let i = 0; i < CHAPTER_LENGTH; i += 1) run = runs.completeRound(run, result(run), library(4)).run;
    expect(run.mistakesLeft).toBe(2);
  });

  it('Relaxed runs never end from misses', () => {
    const run = runs.createRun('relaxed', library(3));
    expect(runs.recordMistake(run)).toBe(run);
  });

  it('clean pictures earn a bigger Arcade bonus and build the streak', () => {
    const run = runs.createRun('arcade', library(3));
    const clean = { ...result(run), mistakes: 0 };
    const messy = { ...result(run), mistakes: 2 };
    expect(runs.roundBonus(run, clean)).toBe(2 * runs.roundBonus(run, messy));
    const after = runs.completeRound(run, clean, library(3)).run;
    expect(after.streak).toBe(1);
    expect(after.score).toBe(clean.score + runs.roundBonus(run, clean));
    expect(runs.completeRound(after, messy, library(3)).run.streak).toBe(0);
  });
});

describe('local resume and bests', () => {
  it('saves and restores a run, and forgets it once ended', () => {
    const { run } = play('relaxed', 7, () => 'mid');
    runs.saveRun(run);
    expect(runs.loadSavedRun()).toEqual(run);
    runs.saveRun(runs.endRun(run));
    expect(runs.loadSavedRun()).toBeNull();
  });

  it('rejects corrupted or old-format saves', () => {
    const { run } = play('arcade', 2, () => 'mid');
    expect(runs.parseRun({ ...run, version: 0 })).toBeNull();
    expect(runs.parseRun({ ...run, stage: 9 })).toBeNull();
    expect(runs.parseRun({ ...run, bag: [1, 2] })).toBeNull();
    expect(runs.parseRun({ ...run, score: 'lots' })).toBeNull();
    expect(runs.parseRun('{')).toBeNull();
    localStorage.setItem('shape-reveal:run:v1', '{not json');
    expect(runs.loadSavedRun()).toBeNull();
  });

  it('clamps a saved level that is outside the mode bounds', () => {
    const run = runs.createRun('relaxed', library(2));
    expect(runs.parseRun({ ...run, challengeLevel: 99 })?.challengeLevel).toBe(MODES.relaxed.maxLevel);
  });

  it('tracks personal bests per mode', () => {
    const arcade = play('arcade', 6, () => 'easy').run;
    let { bests, improved } = runs.updateBests(runs.EMPTY_BESTS, arcade);
    expect(improved).toEqual(['score', 'pictures']);
    expect(bests.arcade.score).toBe(arcade.score);
    ({ bests, improved } = runs.updateBests(bests, arcade));
    expect(improved).toEqual([]);
    const relaxed = play('relaxed', 11, () => 'mid').run;
    ({ bests, improved } = runs.updateBests(bests, relaxed));
    expect(bests.relaxed).toEqual({ pictures: 11, chapters: 2 });
    runs.saveBests(bests);
    expect(runs.loadBests()).toEqual(bests);
  });

  it('loads empty bests from missing or junk storage', () => {
    expect(runs.loadBests()).toEqual(runs.EMPTY_BESTS);
    localStorage.setItem('shape-reveal:bests:v1', JSON.stringify({ arcade: { score: -5 } }));
    expect(runs.loadBests()).toEqual(runs.EMPTY_BESTS);
  });
});
