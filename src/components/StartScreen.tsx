import { useCallback, useState } from 'react';
import { ArrowRight, ChevronsDown, Clock, MoveHorizontal, ArrowDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PUZZLE_IMAGES, DIFFICULTIES } from '@/gameLogic';
import type { GameConfig } from '@/types';
import { prefersReducedMotion } from '@/celebration';

interface StartScreenProps {
  onStart: (config: GameConfig) => void;
}

interface Instruction {
  icon: LucideIcon;
  title: string;
  detail: string;
}

const INSTRUCTIONS: Instruction[] = [
  {
    icon: MoveHorizontal,
    title: 'Move',
    detail: 'Use ← → to position blocks',
  },
  {
    icon: ArrowDown,
    title: 'Drop',
    detail: 'Move the block down',
  },
  {
    icon: ChevronsDown,
    title: 'Drop at Once',
    detail: 'Send the block straight down',
  },
  {
    icon: Clock,
    title: 'Watch the Timer',
    detail: 'Keep an eye on the countdown',
  },
];

/** Must match the screen-exit animation in index.css. */
const EXIT_MS = 300;

export function StartScreen({ onStart }: StartScreenProps) {
  const [leaving, setLeaving] = useState(false);

  const handlePlay = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    // Let the screen clear before the board replaces it.
    window.setTimeout(
      () => onStart({ image: PUZZLE_IMAGES[0], difficulty: DIFFICULTIES.hard }),
      prefersReducedMotion() ? 0 : EXIT_MS,
    );
  }, [leaving, onStart]);

  return (
    <div className={`relative min-h-[100dvh] w-full ${leaving ? 'animate-screen-exit' : ''}`}>
      <div className="brand-backdrop" aria-hidden="true" />

      {/*
        Mobile is a fixed-height, non-scrolling screen: every size below is a
        clamp against viewport height so the whole thing fits a short phone as
        well as a tall one. The lg: layout reverts to normal document flow.
      */}
      <div className="relative z-10 mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden px-5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[clamp(0.75rem,2vh,1.5rem)] lg:h-auto lg:min-h-[100dvh] lg:max-w-6xl lg:grid lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:overflow-visible lg:px-12 lg:py-12">
        {/* ---- Hero ---- */}
        <header className="shrink-0 lg:self-center">
          <div className="flex justify-end lg:justify-start">
            <img
              src="/assets/intuit-logo.png"
              alt="Intuit"
              className="h-[clamp(1.75rem,4vh,2.5rem)] w-auto lg:h-12"
            />
          </div>

          <div className="mt-[clamp(0.5rem,1.5vh,1.5rem)] flex items-start gap-3 lg:mt-10 lg:block">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[clamp(1.9rem,6.2vh,3rem)] font-bold leading-[0.92] tracking-tight text-brand-ink lg:text-7xl">
                HOW TO
                <br />
                <span className="text-brand-blue">PLAY</span>
              </h1>

              <p className="mt-[clamp(0.4rem,1.4vh,1rem)] text-[clamp(0.95rem,2.2vh,1.25rem)] leading-snug text-brand-body lg:mt-6 lg:text-2xl">
                Beat the clock.
                <br />
                Reveal the big picture.
              </p>
            </div>

            <img
              src="/assets/vector-art.png"
              alt=""
              aria-hidden="true"
              className="w-[40%] max-w-[clamp(7rem,22vh,11.5rem)] shrink-0 self-start lg:mt-10 lg:w-[72%] lg:max-w-sm"
            />
          </div>

          {/* Desktop CTA sits with the hero; mobile CTA is pinned below the list. */}
          <button
            onClick={handlePlay}
            className="mt-10 hidden w-full max-w-sm items-center justify-center gap-3 rounded-full bg-brand-blue px-8 py-5 text-xl font-medium text-white shadow-cta transition hover:bg-brand-blue-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-blue active:scale-[0.98] lg:inline-flex"
          >
            Let&rsquo;s Play
            <ArrowRight className="h-6 w-6" strokeWidth={2.5} />
          </button>
        </header>

        {/* ---- Instruction cards ---- */}
        <div className="mt-[clamp(0.6rem,2vh,2rem)] flex min-h-0 flex-1 flex-col lg:mt-0 lg:block lg:flex-none">
          <ul className="flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.45rem,1.5vh,1.25rem)] lg:block lg:space-y-5">
            {INSTRUCTIONS.map(({ icon: Icon, title, detail }, index) => (
              <li
                key={title}
                className="animate-fade-in-up flex items-center gap-[clamp(0.6rem,3vw,1.25rem)] rounded-2xl bg-white p-[clamp(0.55rem,1.6vh,1.25rem)] shadow-card lg:gap-5 lg:p-5"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="flex h-[clamp(2.4rem,6vh,4rem)] w-[clamp(3.1rem,9vw,6rem)] shrink-0 items-center justify-center rounded-xl bg-brand-coral text-white lg:h-16 lg:w-24">
                  <Icon
                    className="h-[clamp(1.15rem,3vh,2rem)] w-[clamp(1.15rem,3vh,2rem)] lg:h-8 lg:w-8"
                    strokeWidth={2.25}
                  />
                </div>

                <div className="h-[clamp(2rem,5vh,3.5rem)] w-px shrink-0 bg-brand-body/25" />

                <div className="min-w-0">
                  <h2 className="font-display text-[clamp(1rem,2.6vh,1.5rem)] font-bold leading-tight text-brand-ink lg:text-2xl">
                    {title}
                  </h2>
                  <p className="mt-0.5 text-[clamp(0.72rem,1.7vh,1rem)] leading-tight text-brand-muted lg:text-base">
                    {detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <button
            onClick={handlePlay}
            className="mt-[clamp(0.6rem,2vh,2rem)] inline-flex w-full shrink-0 items-center justify-center gap-3 rounded-full bg-brand-blue px-8 py-[clamp(0.7rem,2vh,1.25rem)] text-[clamp(1rem,2.4vh,1.25rem)] font-medium text-white shadow-cta transition hover:bg-brand-blue-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-blue active:scale-[0.98] lg:hidden"
          >
            Let&rsquo;s Play
            <ArrowRight className="h-[clamp(1.1rem,2.6vh,1.5rem)] w-[clamp(1.1rem,2.6vh,1.5rem)]" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
