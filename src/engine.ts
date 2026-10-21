import type { BoardSize, GameState, GridTile, Piece, PieceTarget } from './types';
import type { RoundRules } from './model';
import {
  partitionGrid,
  createFallSafePartitionGrid,
  createTilesForPartition,
  createPiecesFromPartitions,
  orderPiecesForSupportedPlacement,
  createEmptyBoard,
  canPlaceOnBoard,
  isAtTarget,
  placeOnBoard,
  spawnPiece,
  clonePiece,
} from './gameLogic';
import { createRng } from './random';

/** Points for each correctly placed piece. */
export const PIECE_SCORE = 100;

/** How many pieces a rejected piece may be pushed back in the queue. */
export const MAX_RETRY_DELAY = 2;

/**
 * Pure game rules. Every function returns a new state and never schedules
 * timers, so the same inputs always give the same result.
 */

/** Build a new round. The seed decides the partition and queue order. */
export function createGame(size: BoardSize, seed: number): GameState {
  const { cols, rows } = size;
  const rng = createRng(seed);

  let partitions = createFallSafePartitionGrid(cols, rows);
  let pieces = createPiecesFromPartitions(partitions);
  let sorted = orderPiecesForSupportedPlacement(pieces, partitions, rows);
  let variety = 0;

  // Prefer varied boards, but only accept a complete queue that the falling
  // mechanic can assemble. The fallback above is always a valid tetromino grid.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = partitionGrid(cols, rows, rng);
    if (candidate.some((part) => part.cells.length !== 4)) continue;
    const candidatePieces = createPiecesFromPartitions(candidate);
    const candidateOrder = orderPiecesForSupportedPlacement(candidatePieces, candidate, rows);
    const candidateVariety = new Set(candidate.map((part) => part.shape)).size;
    if (candidateOrder.length === candidatePieces.length && candidateVariety > variety) {
      partitions = candidate;
      pieces = candidatePieces;
      sorted = candidateOrder;
      variety = candidateVariety;
    }
    if (variety >= 4) break;
  }

  const tileMap = new Map<number, GridTile[]>();
  partitions.forEach((p, i) => {
    tileMap.set(i, createTilesForPartition(p, cols, rows));
  });

  const targets = new Map<number, PieceTarget>();
  partitions.forEach((p, i) => {
    targets.set(i, {
      col: p.originCol,
      row: p.originRow,
      cells: p.cells.map((cell) => ({ ...cell })),
      rotation: p.rotation,
    });
  });

  return {
    board: createEmptyBoard(cols, rows),
    currentPiece: spawnPiece(sorted[0], cols),
    nextPieces: sorted.slice(1),
    partitions: tileMap,
    targets,
    placedPieceIds: new Set(),
    score: 0,
    paused: false,
    won: false,
    totalPieces: partitions.length,
    placedCount: 0,
    wrongFlash: false,
    rejectedPiece: null,
    elapsed: 0,
    mistakes: 0,
    hintOn: false,
    hintedPieceIds: new Set(),
  };
}

/** A state with no board, used before a round is built. */
export function emptyGame(): GameState {
  return {
    board: [],
    currentPiece: null,
    nextPieces: [],
    partitions: new Map(),
    targets: new Map(),
    placedPieceIds: new Set(),
    score: 0,
    paused: false,
    won: false,
    totalPieces: 0,
    placedCount: 0,
    wrongFlash: false,
    rejectedPiece: null,
    elapsed: 0,
    mistakes: 0,
    hintOn: false,
    hintedPieceIds: new Set(),
  };
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    board: state.board.map((row) => [...row]),
    currentPiece: state.currentPiece ? clonePiece(state.currentPiece) : null,
    nextPieces: state.nextPieces.map((p) => clonePiece(p)),
    placedPieceIds: new Set(state.placedPieceIds),
    hintedPieceIds: new Set(state.hintedPieceIds),
  };
}

function targetCells(target: PieceTarget): { col: number; row: number }[] {
  return target.cells.map((cell) => ({
    col: target.col + cell.x,
    row: target.row + cell.y,
  }));
}

/** Whether a piece's target is empty, has a clear lane above, and is supported. */
export function canReachTarget(
  piece: Piece,
  board: (number | null)[][],
  targets: Map<number, PieceTarget>,
  rows: number,
): boolean {
  const target = targets.get(piece.id);
  if (!target) return false;

  const cells = targetCells(target);
  const ownCells = new Set(cells.map((cell) => `${cell.col},${cell.row}`));

  for (const cell of cells) {
    if (board[cell.row]?.[cell.col] !== null) return false;

    for (let row = 0; row < cell.row; row += 1) {
      if (board[row]?.[cell.col] !== null) return false;
    }
  }

  return cells.some((cell) => {
    const rowBelow = cell.row + 1;
    return (
      rowBelow >= rows ||
      (!ownCells.has(`${cell.col},${rowBelow}`) && board[rowBelow]?.[cell.col] !== null)
    );
  });
}

function placeTargetOnBoard(
  piece: Piece,
  board: (number | null)[][],
  targets: Map<number, PieceTarget>,
): boolean {
  const target = targets.get(piece.id);
  if (!target) return false;

  for (const cell of targetCells(target)) {
    if (!board[cell.row] || board[cell.row][cell.col] !== null) return false;
    board[cell.row][cell.col] = piece.id;
  }

  return true;
}

/** Simulate the whole remaining queue placed correctly, in order. */
export function canPlayQueueInOrder(
  board: (number | null)[][],
  targets: Map<number, PieceTarget>,
  queue: Piece[],
  rows: number,
): boolean {
  const simulatedBoard = board.map((row) => [...row]);

  for (const piece of queue) {
    if (
      !canReachTarget(piece, simulatedBoard, targets, rows) ||
      !placeTargetOnBoard(piece, simulatedBoard, targets)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Re-insert a rejected piece as late as possible (up to maxDelay) while the
 * full remaining queue stays playable. Putting it first always works: the
 * board did not change, so the queue is the one that was already feasible.
 */
export function planRetryQueue(
  board: (number | null)[][],
  targets: Map<number, PieceTarget>,
  nextPieces: Piece[],
  retryPiece: Piece,
  maxDelay: number,
  rows: number,
): Piece[] {
  const maxSafeDelay = Math.min(maxDelay, nextPieces.length);

  for (let delay = maxSafeDelay; delay > 0; delay -= 1) {
    const candidateQueue = [
      ...nextPieces.slice(0, delay),
      retryPiece,
      ...nextPieces.slice(delay),
    ];

    if (canPlayQueueInOrder(board, targets, candidateQueue, rows)) {
      return candidateQueue;
    }
  }

  return [retryPiece, ...nextPieces];
}

/** Bring the next queued piece in above the board. */
export function spawnNext(state: GameState, size: BoardSize, rules: RoundRules): GameState {
  const next = { ...state };
  if (next.nextPieces.length > 0) {
    next.currentPiece = spawnPiece(next.nextPieces[0], size.cols);
    next.nextPieces = next.nextPieces.slice(1);
  } else {
    next.currentPiece = null;
  }
  return withHintCharge(next, rules);
}

/** Charge for the hint when a new piece appears while hints are on. */
function withHintCharge(state: GameState, rules: RoundRules): GameState {
  const piece = state.currentPiece;
  if (!state.hintOn || !piece || state.hintedPieceIds.has(piece.id)) return state;
  const hinted = new Set(state.hintedPieceIds);
  hinted.add(piece.id);
  return {
    ...state,
    hintedPieceIds: hinted,
    score: Math.max(0, state.score - rules.hintCost),
  };
}

/**
 * Lock the current piece where it is. A correct placement scores and spawns
 * the next piece; a wrong one is held for the blink-out animation and
 * re-queued without stranding the rest of the puzzle.
 */
export function lockPiece(state: GameState, size: BoardSize, rules: RoundRules): GameState {
  if (!state.currentPiece) return state;
  const piece = state.currentPiece;
  const target = state.targets.get(piece.id);
  if (!target) return state;

  const next = cloneState(state);
  const correct = isAtTarget(piece, target) && canPlaceOnBoard(piece, next.board, size.cols, size.rows);

  if (correct) {
    placeOnBoard(piece, next.board);
    next.placedPieceIds.add(piece.id);
    next.placedCount += 1;
    next.score += PIECE_SCORE;
    next.wrongFlash = false;
    next.rejectedPiece = null;

    if (next.placedCount >= next.totalPieces) {
      next.won = true;
      next.currentPiece = null;
      return next;
    }
    return spawnNext(next, size, rules);
  }

  next.wrongFlash = true;
  next.rejectedPiece = clonePiece(piece);
  next.currentPiece = null;
  next.mistakes += 1;
  next.score = Math.max(0, next.score - rules.wrongPenalty);

  const retryPiece: Piece = {
    ...piece,
    cells: target.cells.map((cell) => ({ ...cell })),
    rotation: target.rotation,
    col: 0,
    row: 0,
  };
  next.nextPieces = planRetryQueue(next.board, next.targets, next.nextPieces, retryPiece, MAX_RETRY_DELAY, size.rows);
  return next;
}

/** Clear the rejected piece once its animation ends and continue. */
export function finishRejection(state: GameState, size: BoardSize, rules: RoundRules): GameState {
  if (!state.rejectedPiece) return state;
  return spawnNext({ ...state, wrongFlash: false, rejectedPiece: null }, size, rules);
}

function isActive(state: GameState): boolean {
  return !state.paused && !state.won && state.currentPiece !== null;
}

export function moveHorizontal(state: GameState, size: BoardSize, delta: number): GameState {
  if (!isActive(state)) return state;
  const piece = clonePiece(state.currentPiece!);
  piece.col += delta;
  return canPlaceOnBoard(piece, state.board, size.cols, size.rows) ? { ...state, currentPiece: piece } : state;
}

/** One row down, locking the piece if it cannot fall further. */
export function moveDown(state: GameState, size: BoardSize, rules: RoundRules): GameState {
  if (!isActive(state)) return state;
  const piece = clonePiece(state.currentPiece!);
  piece.row += 1;
  if (canPlaceOnBoard(piece, state.board, size.cols, size.rows)) {
    return { ...state, currentPiece: piece };
  }
  return lockPiece(state, size, rules);
}

/** Where the piece would come to rest if dropped now. */
export function dropPosition(piece: Piece, board: (number | null)[][], size: BoardSize): Piece {
  let dropped = piece;
  for (;;) {
    const test = { ...dropped, row: dropped.row + 1 };
    if (!canPlaceOnBoard(test, board, size.cols, size.rows)) return dropped;
    dropped = test;
  }
}

export function hardDrop(state: GameState, size: BoardSize, rules: RoundRules): GameState {
  if (!isActive(state)) return state;
  const dropped = dropPosition(clonePiece(state.currentPiece!), state.board, size);
  return lockPiece({ ...state, currentPiece: dropped }, size, rules);
}

/** Toggle the target outline. Each piece first shown with it costs rules.hintCost. */
export function toggleHint(state: GameState, rules: RoundRules): GameState {
  if (state.won) return state;
  if (state.hintOn) return { ...state, hintOn: false };
  return withHintCharge({ ...state, hintOn: true }, rules);
}

export function setPaused(state: GameState, paused: boolean): GameState {
  if (state.won || state.paused === paused) return state;
  return { ...state, paused };
}

export function tick(state: GameState): GameState {
  if (state.paused || state.won) return state;
  return { ...state, elapsed: state.elapsed + 1 };
}
