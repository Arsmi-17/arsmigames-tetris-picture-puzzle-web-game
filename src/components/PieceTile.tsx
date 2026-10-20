import type { GridTile } from '@/types';

interface PieceTileProps {
  tile: GridTile;
  imageUrl: string;
  /** Background size: the image is scaled to cover the entire board area. */
  bgSize: string;
  /** Whether this tile is part of the currently falling piece. */
  isFalling?: boolean;
  /** Whether this tile is part of a wrong-placement flash. */
  isWrong?: boolean;
  /** Whether this tile is correctly placed. */
  isPlaced?: boolean;
  /** Drops the hairline ring so placed tiles merge into one picture. */
  seamless?: boolean;
  /** Optional className for custom sizing. */
  className?: string;
}

/**
 * Renders a single tile that shows a slice of the source image
 * using CSS background-position.
 */
export function PieceTile({
  tile,
  imageUrl,
  bgSize,
  isFalling = false,
  isWrong = false,
  isPlaced = false,
  seamless = false,
  className = '',
}: PieceTileProps) {
  const baseStyle: React.CSSProperties = {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: bgSize,
    backgroundPosition: `${tile.bgPosX}% ${tile.bgPosY}%`,
  };

  let stateClasses = '';
  if (isWrong) {
    stateClasses = 'z-20 animate-shake ring-2 ring-inset ring-brand-coral';
  } else if (isPlaced) {
    stateClasses = seamless ? 'ring-0' : 'ring-1 ring-inset ring-white';
  } else if (isFalling) {
    stateClasses = 'z-20 ring-2 ring-inset ring-white shadow-lg shadow-black/25';
  }

  return (
    <div
      className={`relative overflow-hidden ${
        seamless ? 'transition-shadow duration-[600ms] ease-out' : 'transition-all duration-150'
      } ${stateClasses} ${className}`}
      style={baseStyle}
    />
  );
}
