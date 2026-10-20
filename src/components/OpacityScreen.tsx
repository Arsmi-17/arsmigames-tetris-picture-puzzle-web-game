import { useState } from 'react';
import { PUZZLE_IMAGES, DIFFICULTIES } from '@/gameLogic';
import {
  DEFAULT_BOARD_IMAGE_OPACITY,
  MAX_BOARD_IMAGE_OPACITY,
  MIN_BOARD_IMAGE_OPACITY,
  clampOpacity,
  toCssOpacity,
} from '@/boardOpacity';

/** Values worth trying first. */
const PRESETS = [0, 10, 15, 20, 30];

const { cols, rows } = DIFFICULTIES.hard;
const PREVIEW_IMAGE = PUZZLE_IMAGES[0];

/**
 * Preview-only tool for judging how strongly the finished picture should show
 * through the empty board. Nothing here changes the game: the value that ships
 * is DEFAULT_BOARD_IMAGE_OPACITY in src/boardOpacity.ts.
 */
export function OpacityScreen() {
  // `draft` is what is typed (may be empty mid-edit); `percent` is what renders.
  const [percent, setPercent] = useState(DEFAULT_BOARD_IMAGE_OPACITY);
  const [draft, setDraft] = useState(String(DEFAULT_BOARD_IMAGE_OPACITY));

  const preview = (value: number) => {
    const next = clampOpacity(value);
    setPercent(next);
    setDraft(String(next));
  };

  return (
    <div className="relative min-h-[100dvh] w-full">
      <div className="brand-backdrop" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-md px-6 py-10 lg:max-w-5xl lg:py-14">
        <header>
          <img src="/assets/intuit-logo.png" alt="Intuit" className="h-8 w-auto" />
          <h1 className="mt-5 font-display text-4xl font-bold leading-tight text-brand-ink lg:text-5xl">
            Board image <span className="text-brand-blue">opacity</span>
          </h1>
          <p className="mt-2 text-brand-body">
            Preview only &mdash; how strongly the finished picture shows through
            the empty board.
          </p>
        </header>

        <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-12">
          {/* ---- Live preview, built exactly like the real board ---- */}
          <div>
            <div
              className="relative mx-auto w-full max-w-sm overflow-hidden bg-black lg:max-w-none"
              style={{ aspectRatio: `${cols} / ${rows}` }}
            >
              <img
                src={PREVIEW_IMAGE.url}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
                style={{ opacity: toCssOpacity(percent) }}
              />

              <div
                className="absolute inset-0 grid"
                style={{
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gridTemplateRows: `repeat(${rows}, 1fr)`,
                }}
              >
                {Array.from({ length: cols * rows }).map((_, i) => (
                  <div key={i} style={{ boxShadow: 'inset 0 0 0 1px #ffffff' }} />
                ))}
              </div>
            </div>

            <p className="mt-3 text-center text-sm text-brand-muted lg:text-left">
              Empty board at {percent}% &mdash; this is what a player sees before
              placing any blocks.
            </p>
          </div>

          {/* ---- Controls ---- */}
          <div className="mt-8 lg:mt-0">
            <label
              htmlFor="opacity-input"
              className="block text-sm font-medium text-brand-body"
            >
              Opacity (%)
            </label>

            <input
              id="opacity-input"
              type="number"
              inputMode="numeric"
              min={MIN_BOARD_IMAGE_OPACITY}
              max={MAX_BOARD_IMAGE_OPACITY}
              step={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // Keep the preview live while typing, but ignore an empty box.
                if (e.target.value !== '') setPercent(clampOpacity(Number(e.target.value)));
              }}
              onBlur={() => preview(draft === '' ? DEFAULT_BOARD_IMAGE_OPACITY : Number(draft))}
              className="mt-2 w-28 rounded-xl bg-white px-4 py-3 font-display text-2xl font-bold tabular-nums text-brand-ink shadow-card outline-none ring-brand-blue focus:ring-2"
            />

            <input
              type="range"
              aria-label="Opacity"
              min={MIN_BOARD_IMAGE_OPACITY}
              max={MAX_BOARD_IMAGE_OPACITY}
              step={1}
              value={percent}
              onChange={(e) => preview(Number(e.target.value))}
              className="mt-5 w-full accent-brand-blue"
            />

            <div className="mt-5 flex flex-wrap gap-2">
              {PRESETS.map((value) => (
                <button
                  key={value}
                  onClick={() => preview(value)}
                  className={`rounded-full px-4 py-2 text-sm font-medium shadow-card transition active:scale-95 ${
                    percent === value
                      ? 'bg-brand-blue text-white'
                      : 'bg-white text-brand-body hover:bg-white/70'
                  }`}
                >
                  {value}%
                </button>
              ))}
            </div>

            <a
              href="/"
              className="mt-8 inline-block text-sm font-medium text-brand-blue hover:underline"
            >
              &larr; Back to the game
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
