import type {
  Piece,
  PieceCell,
  PieceTarget,
  TetrisShapeId,
  GridTile,
  DifficultyConfig,
  DifficultyId,
  ImageOption,
} from './types';

export const SPAWN_ROWS = 4;

/** Difficulty presets: board dimensions and fall speed. */
export const DIFFICULTIES: Record<DifficultyId, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    cols: 4,
    rows: 4,
    fallSpeed: 3000,
    description: '4×4 picture · 4 shapes, relaxed pace',
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    cols: 8,
    rows: 8,
    fallSpeed: 2200,
    description: '8×8 picture · 16 shapes, steady pace',
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    cols: 10,
    rows: 10,
    fallSpeed: 1250,
    description: '10×10 picture · 25 shapes, fast pace',
  },
};

/** Original sample artwork shipped in /public/assets. */
export const PUZZLE_IMAGES: ImageOption[] = [
  {
    id: 'aurora',
    label: 'Aurora Lake',
    url: '/assets/aurora.svg',
  },
  {
    id: 'sunset',
    label: 'Sunset Cove',
    url: '/assets/sunset.svg',
  },
];

/** Base Tetris shapes in their default rotation (cells relative to anchor 0,0). */
const SHAPES: Record<TetrisShapeId, PieceCell[]> = {
  I: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ],
  O: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  T: [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ],
  S: [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  Z: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ],
  L: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
  ],
  J: [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
  ],
};

/** All shape ids we can use for partitioning. */
const SHAPE_IDS: TetrisShapeId[] = ['I', 'O', 'T', 'S', 'Z', 'L', 'J'];

/**
 * Rotate a set of cells 90° clockwise around the origin (0,0).
 * Returns a normalized set with non-negative coordinates.
 */
export function rotateCellsCW(cells: PieceCell[]): PieceCell[] {
  // (x, y) -> (-y, x)
  const rotated = cells.map((c) => ({ x: -c.y, y: c.x }));
  return normalizeCells(rotated);
}

/** Rotate cells 90° counter-clockwise. */
export function rotateCellsCCW(cells: PieceCell[]): PieceCell[] {
  // (x, y) -> (y, -x)
  const rotated = cells.map((c) => ({ x: c.y, y: -c.x }));
  return normalizeCells(rotated);
}

/** Shift cells so all coordinates are non-negative. */
function normalizeCells(cells: PieceCell[]): PieceCell[] {
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  return cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
}

/** Get the bounding box of a set of cells. */
export function getBounds(cells: PieceCell[]): { width: number; height: number } {
  const maxX = Math.max(...cells.map((c) => c.x));
  const maxY = Math.max(...cells.map((c) => c.y));
  return { width: maxX + 1, height: maxY + 1 };
}

/** Deep clone a piece. */
export function clonePiece(piece: Piece): Piece {
  return {
    ...piece,
    cells: piece.cells.map((c) => ({ ...c })),
  };
}

/** Convert a shape id + rotation into cell offsets. */
export function getShapeCells(shape: TetrisShapeId, rotation: number): PieceCell[] {
  let cells = SHAPES[shape].map((c) => ({ ...c }));
  for (let i = 0; i < rotation; i++) {
    cells = rotateCellsCW(cells);
  }
  return normalizeCells(cells);
}

/** All rotations for a given shape. */
export function getAllRotations(shape: TetrisShapeId): PieceCell[][] {
  const rotations: PieceCell[][] = [];
  for (let r = 0; r < 4; r++) {
    rotations.push(getShapeCells(shape, r));
  }
  // Deduplicate by string key
  const seen = new Set<string>();
  return rotations.filter((cells) => {
    const key = cells.map((c) => `${c.x},${c.y}`).sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Shape ids that fit within a max-bounds constraint. */
export function getShapesWithinBounds(maxWidth: number, maxHeight: number): TetrisShapeId[] {
  return SHAPE_IDS.filter((id) => {
    const bounds = getBounds(SHAPES[id]);
    return bounds.width <= maxWidth && bounds.height <= maxHeight;
  });
}

/**
 * Partition a cols×rows grid into Tetris-shaped pieces.
 * Returns an array of { shape, rotation, cells, originCol, originRow }.
 * Uses a greedy + backtracking algorithm.
 */
export interface PartitionResult {
  shape: TetrisShapeId;
  rotation: number;
  cells: PieceCell[]; // local cells
  originCol: number; // top-left col on board
  originRow: number; // top-left row on board
}

/**
 * Partition the grid by trying random shapes at random positions,
 * using backtracking to ensure complete coverage.
 */
export function partitionGrid(cols: number, rows: number): PartitionResult[] {
  if (cols < 4 || rows < 4 || cols % 2 !== 0 || rows % 2 !== 0) {
    throw new Error('Picture dimensions must be even and at least 4x4.');
  }
  // Large exact-cover searches can have very long random tails. Build larger
  // pictures from quick 4x4 tetromino tilings, plus O pieces for a 2-cell rim.
  if (cols > 4 || rows > 4) {
    const results: PartitionResult[] = [];
    const tiledCols = Math.floor(cols / 4) * 4;
    const tiledRows = Math.floor(rows / 4) * 4;
    for (let row = 0; row < tiledRows; row += 4) {
      for (let col = 0; col < tiledCols; col += 4) {
        for (const part of partitionGrid(4, 4)) {
          results.push({ ...part, originCol: part.originCol + col, originRow: part.originRow + row });
        }
      }
    }
    for (let col = tiledCols; col < cols; col += 2) {
      for (let row = 0; row < rows; row += 2) {
        results.push({ shape: 'O', rotation: 0, cells: SHAPES.O.map((cell) => ({ ...cell })), originCol: col, originRow: row });
      }
    }
    for (let row = tiledRows; row < rows; row += 2) {
      for (let col = 0; col < tiledCols; col += 2) {
        results.push({ shape: 'O', rotation: 0, cells: SHAPES.O.map((cell) => ({ ...cell })), originCol: col, originRow: row });
      }
    }
    return results;
  }

  const grid: boolean[] = new Array(cols * rows).fill(false); // true = occupied
  const results: PartitionResult[] = [];

  // Build shape candidates with all rotations
  const candidates: { shape: TetrisShapeId; rotation: number; cells: PieceCell[] }[] = [];
  for (const id of SHAPE_IDS) {
    const rotations = getAllRotations(id);
    rotations.forEach((cells, r) => {
      candidates.push({ shape: id, rotation: r, cells });
    });
  }

  function idx(c: number, r: number): number {
    return r * cols + c;
  }

  function canPlace(cells: PieceCell[], originCol: number, originRow: number): boolean {
    for (const cell of cells) {
      const c = originCol + cell.x;
      const r = originRow + cell.y;
      if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
      if (grid[idx(c, r)]) return false;
    }
    return true;
  }

  function place(cells: PieceCell[], originCol: number, originRow: number): void {
    for (const cell of cells) {
      grid[idx(originCol + cell.x, originRow + cell.y)] = true;
    }
  }

  function unplace(cells: PieceCell[], originCol: number, originRow: number): void {
    for (const cell of cells) {
      grid[idx(originCol + cell.x, originRow + cell.y)] = false;
    }
  }

  function findFirstEmpty(): { col: number; row: number } | null {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid[idx(c, r)]) return { col: c, row: r };
      }
    }
    return null;
  }

  function backtrack(): boolean {
    const empty = findFirstEmpty();
    if (!empty) return true; // all filled

    // Shuffle candidates for variety, but only try shapes that cover the first empty cell.
    const shuffled = candidates
      .filter((cand) => cand.cells.some((cell) => cell.x === 0 && cell.y === 0))
      .sort(() => Math.random() - 0.5);

    for (const cand of shuffled) {
      if (canPlace(cand.cells, empty.col, empty.row)) {
        place(cand.cells, empty.col, empty.row);
        results.push({
          shape: cand.shape,
          rotation: cand.rotation,
          cells: cand.cells,
          originCol: empty.col,
          originRow: empty.row,
        });
        if (backtrack()) return true;
        // Undo
        unplace(cand.cells, empty.col, empty.row);
        results.pop();
      }
    }
    return false;
  }

  if (backtrack()) return results;
  return createFallSafePartitionGrid(cols, rows);
}

/**
 * Generate GridTile data for each partition: the background-position
 * to show the correct slice of the source image.
 */
export function createTilesForPartition(
  partition: PartitionResult,
  cols: number,
  rows: number,
): GridTile[] {
  return partition.cells.map((cell) => {
    const boardCol = partition.originCol + cell.x;
    const boardRow = partition.originRow + cell.y;
    // CSS background-position percentage: 0% = left/top, 100% = right/bottom
    // For a grid of N columns, position = col / (N-1) * 100
    const bgPosX = cols > 1 ? `${(boardCol / (cols - 1)) * 100}` : '50';
    const bgPosY = rows > 1 ? `${(boardRow / (rows - 1)) * 100}` : '50';
    return { bgPosX, bgPosY };
  });
}

/** Create a full piece list from partition results. */
export function createPiecesFromPartitions(
  partitions: PartitionResult[],
): Piece[] {
  return partitions.map((p, i) => ({
    id: i,
    shape: p.shape,
    cells: p.cells.map((c) => ({ ...c })),
    rotation: p.rotation,
    col: 0,
    row: 0,
  }));
}

/** Queue pieces so each target has support and an open vertical lane when it appears. */
export function orderPiecesForSupportedPlacement(
  pieces: Piece[],
  partitions: PartitionResult[],
  rows: number,
): Piece[] {
  const remaining = new Set(pieces.map((piece) => piece.id));
  const placed = new Set<number>();
  const cellOwner = new Map<string, number>();
  const prerequisites = new Map<number, Set<number>>();

  partitions.forEach((partition, pieceId) => {
    prerequisites.set(pieceId, new Set());
    for (const cell of partition.cells) {
      const col = partition.originCol + cell.x;
      const row = partition.originRow + cell.y;
      cellOwner.set(`${col},${row}`, pieceId);
    }
  });

  partitions.forEach((partition, pieceId) => {
    for (const cell of partition.cells) {
      const col = partition.originCol + cell.x;
      const targetRow = partition.originRow + cell.y;

      for (let row = 0; row < targetRow; row += 1) {
        const blockerId = cellOwner.get(`${col},${row}`);
        if (blockerId !== undefined && blockerId !== pieceId) {
          prerequisites.get(blockerId)?.add(pieceId);
        }
      }
    }
  });

  const bottomRow = (pieceId: number) => {
    const partition = partitions[pieceId];
    return Math.max(...partition.cells.map((cell) => partition.originRow + cell.y));
  };

  const leftCol = (pieceId: number) => {
    const partition = partitions[pieceId];
    return Math.min(...partition.cells.map((cell) => partition.originCol + cell.x));
  };

  const isSupported = (pieceId: number) => {
    const partition = partitions[pieceId];
    for (const cell of partition.cells) {
      const col = partition.originCol + cell.x;
      const rowBelow = partition.originRow + cell.y + 1;
      if (rowBelow >= rows) return true;

      const belowPiece = cellOwner.get(`${col},${rowBelow}`);
      if (
        belowPiece !== undefined &&
        belowPiece !== pieceId &&
        placed.has(belowPiece)
      ) {
        return true;
      }
    }
    return false;
  };

  const hasOpenLane = (pieceId: number) => {
    const required = prerequisites.get(pieceId);
    if (!required) return true;
    return [...required].every((requiredId) => placed.has(requiredId));
  };

  const orderedIds: number[] = [];
  while (remaining.size > 0) {
    const candidates = [...remaining].filter(
      (pieceId) => isSupported(pieceId) && hasOpenLane(pieceId),
    );

    if (candidates.length === 0) {
      return [];
    }

    candidates.sort((a, b) => {
      const rowDelta = bottomRow(b) - bottomRow(a);
      return rowDelta !== 0 ? rowDelta : leftCol(a) - leftCol(b);
    });

    const nextId = candidates[0];
    remaining.delete(nextId);
    placed.add(nextId);
    orderedIds.push(nextId);
  }

  return orderedIds.map((id) => pieces[id]);
}

/** Deterministic tiling that can always be completed by falling pieces. */
export function createFallSafePartitionGrid(cols: number, rows: number): PartitionResult[] {
  const results: PartitionResult[] = [];

  if (cols !== 10 || rows !== 10) {
    if (cols % 2 !== 0 || rows % 2 !== 0) {
      throw new Error('Puzzle dimensions must be even for tetromino tiling.');
    }
    for (let row = 0; row < rows; row += 2) {
      for (let col = 0; col < cols; col += 2) {
        results.push({
          shape: 'O',
          rotation: 0,
          cells: SHAPES.O.map((cell) => ({ ...cell })),
          originCol: col,
          originRow: row,
        });
      }
    }
    return results;
  }

  for (let row = 0; row < rows; row += 1) {
    results.push({
      shape: 'I',
      rotation: 0,
      cells: SHAPES.I.map((cell) => ({ ...cell })),
      originCol: 0,
      originRow: row,
    });
    results.push({
      shape: 'I',
      rotation: 0,
      cells: SHAPES.I.map((cell) => ({ ...cell })),
      originCol: 4,
      originRow: row,
    });
  }

  for (let row = 0; row < rows; row += 2) {
    results.push({
      shape: 'O',
      rotation: 0,
      cells: SHAPES.O.map((cell) => ({ ...cell })),
      originCol: 8,
      originRow: row,
    });
  }

  return results;
}

/** Check if a piece can be placed at the given position on the board. */
export function canPlaceOnBoard(
  piece: Piece,
  board: (number | null)[][],
  cols: number,
  rows: number,
): boolean {
  for (const cell of piece.cells) {
    const c = piece.col + cell.x;
    const r = piece.row + cell.y;
    if (c < 0 || c >= cols || r >= rows) return false;
    if (r >= 0 && board[r][c] !== null) return false;
  }
  return true;
}

/** Check if piece at current position matches its target exactly. */
export function isAtTarget(
  piece: Piece,
  target: PieceTarget,
): boolean {
  if (piece.col !== target.col || piece.row !== target.row) return false;

  const currentCells = piece.cells
    .map((cell) => `${cell.x},${cell.y}`)
    .sort()
    .join('|');
  const targetCells = target.cells
    .map((cell) => `${cell.x},${cell.y}`)
    .sort()
    .join('|');

  return currentCells === targetCells;
}

/** Place a piece onto the board (mutates board). */
export function placeOnBoard(piece: Piece, board: (number | null)[][]): void {
  for (const cell of piece.cells) {
    const r = piece.row + cell.y;
    const c = piece.col + cell.x;
    if (r >= 0 && r < board.length && c >= 0 && c < board[r].length) {
      board[r][c] = piece.id;
    }
  }
}

/** Remove a piece from the board (mutates board). */
export function removeFromBoard(piece: Piece, board: (number | null)[][]): void {
  for (const cell of piece.cells) {
    const r = piece.row + cell.y;
    const c = piece.col + cell.x;
    board[r][c] = null;
  }
}

/** Create an empty board. */
export function createEmptyBoard(cols: number, rows: number): (number | null)[][] {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

/** Get the leftmost column of a piece's bounding box. */
export function pieceLeftCol(piece: Piece): number {
  return piece.col + Math.min(...piece.cells.map((c) => c.x));
}

/** Get the rightmost column. */
export function pieceRightCol(piece: Piece): number {
  return piece.col + Math.max(...piece.cells.map((c) => c.x));
}

/** Get the bottom row. */
export function pieceBottomRow(piece: Piece): number {
  return piece.row + Math.max(...piece.cells.map((c) => c.y));
}

/** Get the top row. */
export function pieceTopRow(piece: Piece): number {
  return piece.row + Math.min(...piece.cells.map((c) => c.y));
}

/** Spawn a piece centered above the board. */
export function spawnPiece(piece: Piece, cols: number): Piece {
  const bounds = getBounds(piece.cells);
  const startCol = Math.floor((cols - bounds.width) / 2);
  return { ...piece, col: startCol, row: -SPAWN_ROWS };
}
