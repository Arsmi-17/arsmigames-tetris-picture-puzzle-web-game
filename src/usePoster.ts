import { useEffect, useState } from 'react';
import { generateFinishPoster } from '@/poster';
import type { GameConfig } from '@/types';

export const POSTER_HEADLINE = 'The Next level?';
export const POSTER_SUBHEAD = ['That’s going to be', 'game-changing.'];

const POSTER_IMAGE_URL = '/assets/poster-building.png';
const POSTER_IMAGE_LABEL = 'Intuit building poster';

export interface Poster {
  blob: Blob | null;
  url: string | null;
  error: string | null;
}

/**
 * Renders the finish poster off to the side.
 *
 * This is deliberately owned above the win screen so generation can start the
 * moment the last tile lands, while the completion animation is still playing.
 * By the time the win screen appears the PNG is usually ready, so there is no
 * placeholder to sit through.
 */
export function usePoster(
  config: GameConfig | null,
  time: string,
  enabled: boolean,
): Poster {
  const [poster, setPoster] = useState<Poster>({ blob: null, url: null, error: null });

  useEffect(() => {
    if (!enabled || !config) return;

    let active = true;
    let objectUrl: string | null = null;

    setPoster({ blob: null, url: null, error: null });

    generateFinishPoster({
      imageUrl: POSTER_IMAGE_URL,
      imageLabel: POSTER_IMAGE_LABEL,
      time,
      headline: POSTER_HEADLINE,
      subhead: POSTER_SUBHEAD,
    })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPoster({ blob, url: objectUrl, error: null });
      })
      .catch((error) => {
        if (!active) return;
        setPoster({
          blob: null,
          url: null,
          error: error instanceof Error ? error.message : 'Poster could not be generated.',
        });
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [config, enabled, time]);

  return poster;
}
