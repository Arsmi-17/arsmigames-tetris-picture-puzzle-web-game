import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Piece,
  GameState,
  GameConfig,
  GridTile,
  PieceTarget,
} from './types';
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

/** Initialize a new game from the given config. */
function initGame(config: GameConfig): GameState {
  const { cols, rows } = config.difficulty;

  let partitions = createFallSafePartitionGrid(cols, rows);
  let pieces = createPiecesFromPartitions(partitions);
  let sorted = orderPiecesForSupportedPlacement(pieces, partitions, rows);
  let variety = 0;

  // Prefer varied boards, but only accept a complete queue that the falling
  // mechanic can assemble. The fallback above is always a valid tetromino grid.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = partitionGrid(cols, rows);
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

  // Create tiles (image slice data) for each partition
  const tileMap = new Map<number, GridTile[]>();
  partitions.forEach((p, i) => {
    tileMap.set(i, createTilesForPartition(p, cols, rows));
  });

  // Create target positions (where each piece should go)
  const targets = new Map<number, PieceTarget>();
  partitions.forEach((p, i) => {
    targets.set(i, {
      col: p.originCol,
      row: p.originRow,
      cells: p.cells.map((cell) => ({ ...cell })),
      rotation: p.rotation,
    });
  });

  // Spawn the first piece
  const firstPiece = spawnPiece(sorted[0], cols);
  const rest = sorted.slice(1);

  return {
    board: createEmptyBoard(cols, rows),
    currentPiece: firstPiece,
    nextPieces: rest,
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
  };
}

/** Shallow-ish clone of game state for producing new state objects. */
function cloneState(state: GameState): GameState {
  return {
    ...state,
    board: state.board.map((row) => [...row]),
    currentPiece: state.currentPiece ? clonePiece(state.currentPiece) : null,
    nextPieces: state.nextPieces.map((p) => clonePiece(p)),
    placedPieceIds: new Set(state.placedPieceIds),
    partitions: state.partitions,
    targets: state.targets,
  };
}

function targetCells(target: PieceTarget): { col: number; row: number }[] {
  return target.cells.map((cell) => ({
    col: target.col + cell.x,
    row: target.row + cell.y,
  }));
}

function canReachTarget(
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

function canPlayQueueInOrder(state: GameState, queue: Piece[], rows: number): boolean {
  const simulatedBoard = state.board.map((row) => [...row]);

  for (const piece of queue) {
    if (
      !canReachTarget(piece, simulatedBoard, state.targets, rows) ||
      !placeTargetOnBoard(piece, simulatedBoard, state.targets)
    ) {
      return false;
    }
  }

  return true;
}

function planRetryQueue(state: GameState, retryPiece: Piece, maxDelay: number, rows: number): Piece[] {
  const maxSafeDelay = Math.min(maxDelay, state.nextPieces.length);

  for (let delay = maxSafeDelay; delay > 0; delay -= 1) {
    const candidateQueue = [
      ...state.nextPieces.slice(0, delay),
      retryPiece,
      ...state.nextPieces.slice(delay),
    ];

    if (canPlayQueueInOrder(state, candidateQueue, rows)) {
      return candidateQueue;
    }
  }

  return [retryPiece, ...state.nextPieces];
}

export interface GameEngine {
  state: GameState;
  moveLeft: () => void;
  moveRight: () => void;
  moveDown: () => void;
  hardDrop: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

export function useGameEngine(config: GameConfig | null): GameEngine {
  const [state, setState] = useState<GameState | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const configRef = useRef<GameConfig | null>(config);
  const fallTimerRef = useRef<number | null>(null);
  const clockTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Initialize / reset game when config changes
  useEffect(() => {
    if (!config) {
      setState(null);
      return;
    }
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    configRef.current = config;
    setState(initGame(config));
  }, [config]);

  // Spawn next piece
  const spawnNext = useCallback((s: GameState): GameState => {
    if (!configRef.current) return s;
    const { cols } = configRef.current.difficulty;
    const newState = { ...s };
    if (newState.nextPieces.length > 0) {
      const next = newState.nextPieces[0];
      newState.currentPiece = spawnPiece(next, cols);
      newState.nextPieces = newState.nextPieces.slice(1);
    } else {
      newState.currentPiece = null;
    }
    return newState;
  }, []);

  // Try to lock the current piece
  const tryLockPiece = useCallback(
    (s: GameState): GameState => {
      if (!s.currentPiece || !configRef.current) return s;
      const piece = s.currentPiece;
      const { cols, rows } = configRef.current.difficulty;
      const target = s.targets.get(piece.id);

      if (!target) return s;

      const newState = cloneState(s);
      const atTarget = isAtTarget(piece, target);
      const canPlace = canPlaceOnBoard(piece, newState.board, cols, rows);

      if (atTarget && canPlace) {
        // Correct placement!
        placeOnBoard(piece, newState.board);
        newState.placedPieceIds.add(piece.id);
        newState.placedCount += 1;
        newState.score += 100;
        newState.wrongFlash = false;
        newState.rejectedPiece = null;

        // Check win
        if (newState.placedCount >= newState.totalPieces) {
          newState.won = true;
          newState.currentPiece = null;
          return newState;
        }

        // Spawn next
        return spawnNext(newState);
      }

      // Wrong placement — remove piece, re-queue it
      // Keep the rejected piece on screen so it can blink before vanishing.
      newState.wrongFlash = true;
      newState.rejectedPiece = clonePiece(piece);
      newState.currentPiece = null;
      newState.score = Math.max(0, newState.score - 25);

      const retryPiece: Piece = {
        ...piece,
        cells: target.cells.map((cell) => ({ ...cell })),
        rotation: target.rotation,
        col: 0,
        row: 0,
      };

      newState.nextPieces = planRetryQueue(newState, retryPiece, 2, rows);

      // Let the rejected piece blink out, then continue with the queue.
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(() => {
        setState((prev) => {
          if (!prev) return prev;
          if (!configRef.current) return prev;
          const cleared = { ...prev, wrongFlash: false, rejectedPiece: null };
          return spawnNext(cleared);
        });
      }, 900);

      return newState;
    },
    [spawnNext],
  );

  // Move piece horizontally
  const moveHorizontal = useCallback(
    (delta: number) => {
      setState((prev) => {
        if (!prev || prev.paused || prev.won || !prev.currentPiece) return prev;
        const { cols } = configRef.current!.difficulty;
        const piece = clonePiece(prev.currentPiece);
        piece.col += delta;
        if (canPlaceOnBoard(piece, prev.board, cols, configRef.current!.difficulty.rows)) {
          return { ...prev, currentPiece: piece };
        }
        return prev;
      });
    },
    [],
  );

  const moveLeft = useCallback(() => moveHorizontal(-1), [moveHorizontal]);
  const moveRight = useCallback(() => moveHorizontal(1), [moveHorizontal]);

  // Move piece down (soft drop)
  const moveDown = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.paused || prev.won || !prev.currentPiece) return prev;
      const { cols, rows } = configRef.current!.difficulty;
      const piece = clonePiece(prev.currentPiece);
      piece.row += 1;

      if (canPlaceOnBoard(piece, prev.board, cols, rows)) {
        // return { ...prev, currentPiece: piece, score: prev.score + 1 };
        return { ...prev, currentPiece: piece };
      }

      // Can't move down — try to lock
      return tryLockPiece(prev);
    });
  }, [tryLockPiece]);

  // Hard drop — instantly move piece to bottom or target
  const hardDrop = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.paused || prev.won || !prev.currentPiece) return prev;
      const { cols, rows } = configRef.current!.difficulty;
      const piece = clonePiece(prev.currentPiece);

      // Drop as far as possible
      let dropped = piece;
      while (true) {
        const test = clonePiece(dropped);
        test.row += 1;
        if (canPlaceOnBoard(test, prev.board, cols, rows)) {
          dropped = test;
        } else {
          break;
        }
      }

      const newState = { ...prev, currentPiece: dropped };
      return tryLockPiece(newState);
    });
  }, [tryLockPiece]);

  // Pause / resume
  const pause = useCallback(() => {
    setState((prev) => (prev ? { ...prev, paused: true } : prev));
  }, []);

  const resume = useCallback(() => {
    setState((prev) => (prev ? { ...prev, paused: false } : prev));
  }, []);

  // Reset
  const reset = useCallback(() => {
    if (configRef.current) {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
      setState(initGame(configRef.current));
    }
  }, []);

  const hasGame = state !== null;
  const currentPieceId = state?.currentPiece?.id ?? null;

  // Game loop — gravity
  useEffect(() => {
    if (!hasGame || state?.paused || state?.won || currentPieceId === null) {
      if (fallTimerRef.current) {
        clearInterval(fallTimerRef.current);
        fallTimerRef.current = null;
      }
      return;
    }

    const speed = configRef.current?.difficulty.fallSpeed ?? 730;
    fallTimerRef.current = window.setInterval(() => {
      moveDown();
    }, speed);

    return () => {
      if (fallTimerRef.current) {
        clearInterval(fallTimerRef.current);
        fallTimerRef.current = null;
      }
    };
  }, [hasGame, state?.paused, state?.won, currentPieceId, moveDown]);

  // Clock timer — elapsed time
  useEffect(() => {
    if (!hasGame || state?.paused || state?.won) return;

    clockTimerRef.current = window.setInterval(() => {
      setState((prev) => (prev ? { ...prev, elapsed: prev.elapsed + 1 } : prev));
    }, 1000);

    return () => {
      if (clockTimerRef.current) {
        clearInterval(clockTimerRef.current);
        clockTimerRef.current = null;
      }
    };
  }, [hasGame, state?.paused, state?.won]);

  // Keyboard input
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!stateRef.current || stateRef.current.paused || stateRef.current.won) {
        if (e.key === 'p' || e.key === 'P') {
          if (stateRef.current?.paused) resume();
          else pause();
        }
        return;
      }

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
          e.preventDefault();
          hardDrop();
          break;
        case 'p':
        case 'P':
          pause();
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [moveLeft, moveRight, moveDown, hardDrop, pause, resume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fallTimerRef.current) clearInterval(fallTimerRef.current);
      if (clockTimerRef.current) clearInterval(clockTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  return {
    state: state ?? {
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
    },
    moveLeft,
    moveRight,
    moveDown,
    hardDrop,
    pause,
    resume,
    reset,
  };
}
