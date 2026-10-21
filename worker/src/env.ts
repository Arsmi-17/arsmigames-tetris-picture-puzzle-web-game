export interface Env {
  /** Built game and admin UI (Pages static assets). */
  ASSETS: Fetcher;
  /** Gameplay events (Workers Analytics Engine). Optional in local dev. */
  ANALYTICS?: AnalyticsEngineDataset;
  /** Rate Limiting binding for event intake. Optional. */
  EVENTS_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };

  /** Supabase project URL, e.g. "https://abcd1234.supabase.co". */
  SUPABASE_URL: string;
  /** Supabase service_role key (secret). Server side only; bypasses RLS. */
  SUPABASE_SERVICE_ROLE_KEY: string;

  /** The admin's sign-in email. */
  ADMIN_EMAIL: string;
  /** The admin's sign-in key (secret, at least 4 characters). Changing it signs everyone out. */
  ADMIN_KEY: string;

  /** Optional comma-separated allowlist of image hosts. Empty allows any https host. */
  IMAGE_HOSTS?: string;
  /** Public game origin, used to check image CORS and accept events. */
  GAME_ORIGIN: string;
}
