import { describe, expect, it } from 'vitest';
import * as engine from '@/engine';
import type { GameState } from '@/types';
import type { RoundRules } from '@/model';
import { createRng } from '@/random';

const RULES: RoundRules = { wrongPenalty: 25, hintCost: 0, landingPreview: false };
const SEEDS = Number(process.env.ENGINE_SEEDS ?? 120);

function queue(state: GameState) {
  return state.currentPiece ? [state.currentPiece, ...state.nextPieces] : state.nextPieces;
}

function remainingIsPlayable(state: GameState, rows: number) {
  return engine.canPlayQueueInOrder(state.board, state.targets, queue(state), rows);
}

/** Steer the current piece to its target column above the board, then drop. */
function placeCorrectly(state: GameState, size: { cols: number; rows: number }, rules = RULES): GameState {
  const target = state.targets.get(state.currentPiece!.id)!;
  let s = state;
  for (let guard = 0; s.currentPiece!.col !== target.col && guard < 30; guard += 1) {
    s = engine.moveHorizontal(s, size, target.col > s.currentPiece!.col ? 1 : -1);
  }
  return engine.hardDrop(s, size, rules);
}

/** Drop in a wrong column (or the right column if that is the only legal one). */
function dropWrong(state: GameState, size: { cols: number; rows: number }, rng: () => number): GameState {
  let s = state;
  const shifts = Math.floor(rng() * size.cols) - Math.floor(size.cols / 2);
  for (let i = 0; i < Math.abs(shifts); i += 1) s = engine.moveHorizontal(s, size, Math.sign(shifts));
  return engine.hardDrop(s, size, RULES);
}

describe('round simulation', () => {
  for (const n of [4, 6, 8, 10]) {
    it(`${n}×${n}: random wrong drops never strand the remaining queue (${SEEDS} seeds)`, () => {
      const size = { cols: n, rows: n };
      let totalMistakes = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const rng = createRng(seed * 7919);
        let s = engine.createGame(size, seed);
        expect(remainingIsPlayable(s, n)).toBe(true);
        let steps = 0;
        while (!s.won) {
          steps += 1;
          expect(steps).toBeLessThan(2000);
          if (s.rejectedPiece) {
            expect(engine.canPlayQueueInOrder(s.board, s.targets, s.nextPieces, n)).toBe(true);
            s = engine.finishRejection(s, size, RULES);
            continue;
          }
          s = rng() < 0.35 ? dropWrong(s, size, rng) : placeCorrectly(s, size);
          if (!s.won && !s.rejectedPiece) expect(remainingIsPlayable(s, n)).toBe(true);
        }
        expect(s.placedCount).toBe(s.totalPieces);
        expect(s.board.flat().every((cell) => cell !== null)).toBe(true);
        expect(s.currentPiece).toBeNull();
        totalMistakes += s.mistakes;
      }
      // The run must actually exercise the retry path.
      expect(totalMistakes).toBeGreaterThan(SEEDS / 2);
    });
  }
});

describe('engine rules', () => {
  const size = { cols: 8, rows: 8 };

  it('same seed builds the same round', () => {
    const a = engine.createGame(size, 99);
    const b = engine.createGame(size, 99);
    expect(queue(a).map((p) => p.id)).toEqual(queue(b).map((p) => p.id));
    expect([...a.targets.entries()]).toEqual([...b.targets.entries()]);
  });

  it('scores correct pieces and penalises wrong drops without going below zero', () => {
    let s = engine.createGame(size, 5);
    s = placeCorrectly(s, size);
    expect(s.score).toBe(engine.PIECE_SCORE);
    expect(s.placedCount).toBe(1);

    let wrong = s;
    const target = s.targets.get(s.currentPiece!.id)!;
    // Move as far from the target as possible, then drop.
    const dir = target.col > size.cols / 2 ? -1 : 1;
    for (let i = 0; i < size.cols; i += 1) wrong = engine.moveHorizontal(wrong, size, dir);
    wrong = engine.hardDrop(wrong, size, RULES);
    expect(wrong.rejectedPiece).not.toBeNull();
    expect(wrong.mistakes).toBe(1);
    expect(wrong.score).toBe(engine.PIECE_SCORE - RULES.wrongPenalty);
    expect(wrong.board).toEqual(s.board);

    const fresh = engine.createGame(size, 5);
    let zero = fresh;
    for (let i = 0; i < size.cols; i += 1) zero = engine.moveHorizontal(zero, size, -1);
    zero = engine.hardDrop(zero, size, RULES);
    if (zero.rejectedPiece) expect(zero.score).toBe(0);
  });

  it('the win transition clears the falling piece and stops input', () => {
    let s = engine.createGame({ cols: 4, rows: 4 }, 3);
    while (!s.won) s = placeCorrectly(s, { cols: 4, rows: 4 });
    expect(s.won).toBe(true);
    expect(s.score).toBe(4 * engine.PIECE_SCORE);
    expect(engine.moveDown(s, { cols: 4, rows: 4 }, RULES)).toBe(s);
    expect(engine.tick(s)).toBe(s);
    expect(engine.setPaused(s, true)).toBe(s);
  });

  it('pause freezes movement and the clock', () => {
    const s = engine.setPaused(engine.createGame(size, 1), true);
    expect(engine.moveHorizontal(s, size, 1)).toBe(s);
    expect(engine.moveDown(s, size, RULES)).toBe(s);
    expect(engine.hardDrop(s, size, RULES)).toBe(s);
    expect(engine.tick(s)).toBe(s);
    const resumed = engine.setPaused(s, false);
    expect(engine.tick(resumed).elapsed).toBe(1);
  });

  it('hints cost once per piece and carry over to new pieces while on', () => {
    const rules = { ...RULES, hintCost: 10 };
    let s = engine.createGame(size, 8);
    s = placeCorrectly(s, size, rules);
    s = placeCorrectly(s, size, rules);
    expect(s.score).toBe(200);
    s = engine.toggleHint(s, rules);
    expect(s.hintOn).toBe(true);
    expect(s.score).toBe(190);
    s = engine.toggleHint(engine.toggleHint(s, rules), rules);
    expect(s.score).toBe(190);
    s = placeCorrectly(s, size, rules);
    expect(s.hintedPieceIds.size).toBe(2);
    expect(s.score).toBe(190 + 100 - 10);
  });

  it('landing position matches a hard drop', () => {
    const s = engine.createGame(size, 12);
    const landing = engine.dropPosition(s.currentPiece!, s.board, size);
    expect(landing.row).toBeGreaterThanOrEqual(0);
    const dropped = engine.hardDrop(s, size, RULES);
    const placed = dropped.board.flat().filter((cell) => cell === s.currentPiece!.id).length;
    expect(placed === 4 || dropped.rejectedPiece?.row === landing.row).toBe(true);
  });
});
