import type { GameState, GameConfig } from '@/types';
import { DEFAULT_BOARD_IMAGE_OPACITY, toCssOpacity } from '@/boardOpacity';
import { HEAL_MS, LIFT_DELAY_MS } from '@/celebration';
import { PieceTile } from './PieceTile';
import { SPAWN_ROWS } from '@/gameLogic';

interface GameBoardProps {
  state: GameState;
  config: GameConfig;
  cellSize: number;
  /** Plays the completion sequence: seams dissolve, then the board lifts. */
  celebrating?: boolean;
}

/** Width of the white seams between tiles, matching the reference UI. */
const SEAM = 2;

/**
 * How strongly the finished picture shows through the empty board, 0 to 1.
 * Raise it to make the puzzle easier to read, drop it to 0 to hide it entirely.
 */
export const BOARD_IMAGE_OPACITY = 0.25;

export function GameBoard({ state, config, cellSize, celebrating = false }: GameBoardProps) {
  const { cols, rows } = config.difficulty;
  const imageUrl = config.image.url;
  const boardWidth = cols * cellSize;
  const boardHeight = rows * cellSize;
  const spawnHeight = SPAWN_ROWS * cellSize;
  const bgSize = `${boardWidth}px ${boardHeight}px`;

  const getTiles = (pieceId: number) => state.partitions.get(pieceId) ?? [];

  if (state.board.length === 0 || cellSize <= 0) {
    return (
      <div
        className="animate-pulse rounded-lg bg-black/10"
        style={{ width: cols * 40, height: rows * 40 }}
      />
    );
  }

  return (
    <div
      className="relative select-none"
      style={{
        width: boardWidth,
        height: boardHeight + spawnHeight,
        transform: celebrating ? 'scale(1.03)' : 'scale(1)',
        transition: `transform 420ms cubic-bezier(0.22, 1, 0.36, 1) ${LIFT_DELAY_MS}ms`,
      }}
    >
      {/* ---- Spawn zone: slightly lifted off the board so pieces read as "incoming" ---- */}
      <div
        className="absolute left-0 top-0 overflow-hidden bg-[#222020]"
        style={{
          width: boardWidth,
          height: spawnHeight,
          opacity: celebrating ? 0 : 1,
          transition: `opacity ${Math.round(HEAL_MS * 0.55)}ms ease-out`,
        }}
      >
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'linear-gradient(#ffffff 2px, transparent 2px), linear-gradient(90deg, #ffffff 2px, transparent 2px)',
            backgroundSize: `${cellSize}px ${cellSize}px`,
          }}
        />
      </div>

      {/* ---- Playfield ---- */}
      <div
        className="absolute left-0 overflow-hidden bg-black"
        style={{ top: spawnHeight, width: boardWidth, height: boardHeight }}
      >
        <img
          src={imageUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
          style={{ opacity: toCssOpacity(DEFAULT_BOARD_IMAGE_OPACITY) }}
        />

        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
          }}
        >
          {Array.from({ length: rows * cols }).map((_, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const cellValue = state.board[row][col];

            return (
              <div
                key={i}
                className="relative"
                style={{
                  width: cellSize,
                  height: cellSize,
                  // White seams drawn as insets keeps the grid crisp at any cell size.
                  boxShadow: celebrating
                    ? 'inset 0 0 0 0 rgba(255,255,255,0)'
                    : `inset 0 0 0 ${SEAM / 2}px #ffffff`,
                  transition: `box-shadow ${HEAL_MS}ms ease-out`,
                }}
              >
                {cellValue !== null && (() => {
                  const tiles = getTiles(cellValue);
                  const target = state.targets.get(cellValue);
                  if (!target) return null;
                  const expectedX = cols > 1 ? `${(col / (cols - 1)) * 100}` : '50';
                  const expectedY = rows > 1 ? `${(row / (rows - 1)) * 100}` : '50';
                  const tileIdx = tiles.findIndex(
                    (t) => t.bgPosX === expectedX && t.bgPosY === expectedY,
                  );
                  if (tileIdx < 0) return null;
                  return (
                    <PieceTile
                      tile={tiles[tileIdx]}
                      imageUrl={imageUrl}
                      bgSize={bgSize}
                      isPlaced
                      seamless={celebrating}
                      className="h-full w-full"
                    />
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- Rejected piece: blinks in place before vanishing ---- */}
      {state.rejectedPiece && (() => {
        const rejected = state.rejectedPiece;
        const tiles = getTiles(rejected.id);
        return (
          <div className="animate-blink-out pointer-events-none absolute inset-0 z-40">
            {rejected.cells.map((cell, tileIdx) => {
              const tile = tiles[tileIdx];
              if (!tile) return null;
              return (
                <div
                  key={`rejected-${rejected.id}-${tileIdx}`}
                  className="absolute overflow-hidden ring-2 ring-inset ring-brand-coral"
                  style={{
                    left: (rejected.col + cell.x) * cellSize,
                    top: (rejected.row + cell.y + SPAWN_ROWS) * cellSize,
                    width: cellSize,
                    height: cellSize,
                    backgroundImage: `url(${imageUrl})`,
                    backgroundSize: bgSize,
                    backgroundPosition: `${tile.bgPosX}% ${tile.bgPosY}%`,
                  }}
                >
                  <div className="absolute inset-0 bg-brand-coral/35" />
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ---- Falling piece ---- */}
      {state.currentPiece && (() => {
        const tiles = getTiles(state.currentPiece.id);
        return state.currentPiece.cells.map((cell, tileIdx) => {
          const tile = tiles[tileIdx];
          if (!tile) return null;
          return (
            <div
              key={`${state.currentPiece!.id}-${tileIdx}`}
              className="absolute z-30"
              style={{
                left: (state.currentPiece!.col + cell.x) * cellSize,
                top: (state.currentPiece!.row + cell.y + SPAWN_ROWS) * cellSize,
                width: cellSize,
                height: cellSize,
              }}
            >
              <PieceTile
                tile={tile}
                imageUrl={imageUrl}
                bgSize={bgSize}
                isFalling
                isWrong={state.wrongFlash}
                className="h-full w-full"
              />
            </div>
          );
        });
      })()}
    </div>
  );
}
