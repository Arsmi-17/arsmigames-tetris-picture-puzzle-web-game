/**
 * How strongly the finished picture shows through the empty board.
 *
 * Expressed as a whole percentage (10, 15, 20 …) because that is how it is
 * talked about; only the CSS layer needs the 0–1 form.
 *
 * This is the single source of truth. Change it here and redeploy — the
 * /opacity page only previews values, it cannot set them.
 */

export const DEFAULT_BOARD_IMAGE_OPACITY = 20;

export const MIN_BOARD_IMAGE_OPACITY = 0;
export const MAX_BOARD_IMAGE_OPACITY = 100;

export function clampOpacity(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_BOARD_IMAGE_OPACITY;
  return Math.min(
    MAX_BOARD_IMAGE_OPACITY,
    Math.max(MIN_BOARD_IMAGE_OPACITY, Math.round(percent)),
  );
}

/** The 0–1 value CSS wants. */
export function toCssOpacity(percent: number): number {
  return clampOpacity(percent) / 100;
}
