/** Direction for rotation. */
export type RotationDirection = 'cw' | 'ccw';

/** Represents a single cell position in a piece's local coordinate system. */
export interface PieceCell {
  /** X offset within the piece's local grid (left = 0). */
  x: number;
  /** Y offset within the piece's local grid (top = 0). */
  y: number;
}

/** Represents one Tetris piece being controlled by the player. */
export interface Piece {
  /** Unique identifier for this piece instance. */
  id: number;
  /** The shape template identifier (e.g. 'I', 'O'). */
  shape: TetrisShapeId;
  /** Relative cell offsets defining the shape. */
  cells: PieceCell[];
  /** Current rotation state 0-3. */
  rotation: number;
  /** Column offset of the piece's anchor on the game board. */
  col: number;
  /** Row offset of the piece's anchor on the game board. */
  row: number;
}

/** Maps a piece id to a unique color, for styling purposes (optional). */
export interface BoardCell {
  /** Piece id that occupies this cell, or null if empty. */
  pieceId: number | null;
}

/** A tile in the partitioned grid, with image background coordinates. */
export interface GridTile {
  /** Background-position-x for CSS (percentage). */
  bgPosX: string;
  /** Background-position-y for CSS (percentage). */
  bgPosY: string;
}

/** Exact board placement a piece must match before it can lock. */
export interface PieceTarget {
  /** Target anchor column. */
  col: number;
  /** Target anchor row. */
  row: number;
  /** Required local cells for the completed picture. */
  cells: PieceCell[];
  /** Required rotation state for retrying the original piece. */
  rotation: number;
}

/** Difficulty levels mapped to board dimensions and partition count. */
export interface DifficultyConfig {
  id: DifficultyId;
  label: string;
  /** Number of columns in the game board. */
  cols: number;
  /** Number of rows in the game board. */
  rows: number;
  /** Fall speed in milliseconds. */
  fallSpeed: number;
  /** Description shown on the selection card. */
  description: string;
}

export type DifficultyId = 'easy' | 'medium' | 'hard';

/** The seven standard Tetris shape identifiers plus a few extra. */
export type TetrisShapeId =
  | 'I'
  | 'O'
  | 'T'
  | 'S'
  | 'Z'
  | 'L'
  | 'J'
  | 'P'
  | 'U'
  | 'X';

/** Image option for the puzzle. */
export interface ImageOption {
  id: string;
  label: string;
  url: string;
}

/** All screens in the game. */
export type GameScreen = 'start' | 'playing' | 'won';

/** Full game configuration chosen on the start screen. */
export interface GameConfig {
  image: ImageOption;
  difficulty: DifficultyConfig;
}

/** Mutable game state managed by the engine. */
export interface GameState {
  /** 2D grid: board[row][col] — null = empty, number = placed piece id. */
  board: (number | null)[][];
  /** Currently falling piece, or null if none. */
  currentPiece: Piece | null;
  /** Queue of upcoming pieces. */
  nextPieces: Piece[];
  /** Partitions: maps pieceId to its grid tiles (image slices). */
  partitions: Map<number, GridTile[]>;
  /** Exact target placement for each piece. */
  targets: Map<number, PieceTarget>;
  /** Set of piece ids that have been correctly placed. */
  placedPieceIds: Set<number>;
  /** Score. */
  score: number;
  /** Whether the game is paused. */
  paused: boolean;
  /** Whether the game is over (all pieces placed). */
  won: boolean;
  /** Total number of pieces to place. */
  totalPieces: number;
  /** Number of pieces correctly placed. */
  placedCount: number;
  /** Whether the current piece is in a temporary "wrong" flash state. */
  wrongFlash: boolean;
  /**
   * A piece that was just rejected, held purely for the blink-out animation.
   * It is not controllable and the engine never moves it — it is cleared when
   * the flash timer fires and the retry piece spawns.
   */
  rejectedPiece: Piece | null;
  /** Elapsed time in seconds. */
  elapsed: number;
}
