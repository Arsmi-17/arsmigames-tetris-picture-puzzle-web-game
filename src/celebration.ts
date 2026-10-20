/**
 * Timings for the completion sequence that plays between the last tile
 * locking and the win screen appearing.
 *
 * The board heals (white seams dissolve so the tiles read as one photograph),
 * lifts, then the whole screen fades out. Keep these in step with the
 * `screen-dissolve` keyframes in index.css.
 */

/** Seams fade out — the payoff shot. */
export const HEAL_MS = 600;

/** The board lifts slightly once healed. */
export const LIFT_DELAY_MS = 600;

/** Total time before the win screen replaces the board. */
export const CELEBRATION_MS = 1300;

/**
 * index.css collapses every animation to ~0ms under prefers-reduced-motion.
 * The JS timers that swap screens must collapse too, or the animation ends
 * instantly and leaves a blank screen until the timer catches up.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
