import { describe, expect, it } from 'vitest';
import {
  SPAWN_ROWS,
  canPlaceOnBoard,
  createEmptyBoard,
  createPiecesFromPartitions,
  orderPiecesForSupportedPlacement,
  partitionGrid,
  placeOnBoard,
} from '@/gameLogic';
import { createRng } from '@/random';

const SEEDS = Number(process.env.PUZZLE_SEEDS ?? 300);

/** Partition, order, and physically drop every piece. */
function verifyBoard(size: number, seed: number): void {
  const parts = partitionGrid(size, size, createRng(seed));
  const pieces = createPiecesFromPartitions(parts);
  const order = orderPiecesForSupportedPlacement(pieces, parts, size);
  const coverage = Array(size * size).fill(0);

  expect(parts.length).toBe((size * size) / 4);
  expect(order.length, 'every piece needs a playable order').toBe(pieces.length);
  for (const part of parts) {
    expect(part.cells.length).toBe(4);
    for (const cell of part.cells) {
      const x = part.originCol + cell.x;
      const y = part.originRow + cell.y;
      expect(x >= 0 && x < size && y >= 0 && y < size).toBe(true);
      coverage[y * size + x] += 1;
    }
  }
  expect(coverage.every((count) => count === 1), 'picture must be tiled exactly once').toBe(true);

  const board = createEmptyBoard(size, size);
  for (const piece of order) {
    const target = parts[piece.id];
    const falling = { ...piece, col: target.originCol, row: -SPAWN_ROWS };
    while (canPlaceOnBoard({ ...falling, row: falling.row + 1 }, board, size, size)) {
      falling.row += 1;
    }
    expect(falling.row, 'piece must fall to its target without obstruction').toBe(target.originRow);
    placeOnBoard(falling, board);
  }
  expect(board.every((row) => row.every((cell) => cell !== null))).toBe(true);
}

describe('puzzle generation', () => {
  for (const size of [4, 6, 8, 10]) {
    it(`${size}×${size}: ${SEEDS} seeds tile exactly and fall into place`, () => {
      for (let seed = 1; seed <= SEEDS; seed += 1) verifyBoard(size, seed);
    });
  }

  it('the same seed rebuilds the same partition', () => {
    const a = partitionGrid(8, 8, createRng(42));
    const b = partitionGrid(8, 8, createRng(42));
    expect(a).toEqual(b);
  });

  it('different seeds give varied partitions', () => {
    const keys = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) {
      keys.add(JSON.stringify(partitionGrid(4, 4, createRng(seed)).map((p) => [p.shape, p.originCol, p.originRow])));
    }
    expect(keys.size).toBeGreaterThan(3);
  });

  it('rejects odd or tiny boards', () => {
    expect(() => partitionGrid(5, 5)).toThrow();
    expect(() => partitionGrid(2, 2)).toThrow();
  });
});
