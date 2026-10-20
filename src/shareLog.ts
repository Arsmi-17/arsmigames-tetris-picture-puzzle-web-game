import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Records poster completion metadata in the existing Supabase table.
 *
 * Share logging is best-effort. Download logging reports success to the caller
 * so the screen can show a failure when Supabase is unavailable.
 * See supabase/migrations/0001_intuit_tetris_share_poster.sql for the table.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

export const shareLogEnabled = client !== null;

export interface ShareEvent {
  /** Finish time in whole seconds. */
  completionSeconds: number;
  /** The same time as shown to the player, e.g. "0:58". */
  completionDisplay: string;
}

async function insertPosterEvent({
  completionSeconds,
  completionDisplay,
}: ShareEvent): Promise<boolean> {
  if (!client) return false;

  try {
    const { error } = await client.from('intuit_tetris_share_poster').insert({
      completion_seconds: completionSeconds,
      completion_display: completionDisplay,
    });
    if (error) {
      console.warn('Could not log poster event:', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Could not log poster event:', error);
    return false;
  }
}

// The existing poster-event table stores completion metadata, not image bytes.
export async function logDownloadEvent(event: ShareEvent): Promise<boolean> {
  return insertPosterEvent(event);
}

/**
 * Appends one share event. Never throws and never blocks the share itself —
 * a logging outage must not stop a player from sharing their poster.
 */
export async function logShareEvent({
  completionSeconds,
  completionDisplay,
}: ShareEvent): Promise<void> {
  await insertPosterEvent({ completionSeconds, completionDisplay });
}
