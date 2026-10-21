export interface Env {
  /** Built game and admin UI (Workers Static Assets). */
  ASSETS: Fetcher;
  /** Picture catalog source of truth. */
  DB: D1Database;
  /** Private bucket holding the published catalog JSON. */
  CATALOG_BUCKET: R2Bucket;
  /** Gameplay events (Workers Analytics Engine). Optional in local dev. */
  ANALYTICS?: AnalyticsEngineDataset;
  /** Workers Rate Limiting binding for event intake. Optional. */
  EVENTS_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };

  /** Cloudflare Access team domain, e.g. "myteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN: string;
  /** Application Audience (AUD) tag of the Access application protecting /admin. */
  ACCESS_AUD: string;
  /** Optional extra allowlist of admin emails, comma separated. */
  ADMIN_EMAILS?: string;
  /** Approved image hosts, comma separated, e.g. "images.example.com". */
  IMAGE_HOSTS: string;
  /** Public game origin, used to check image CORS, e.g. "https://play.example.com". */
  GAME_ORIGIN: string;
  /**
   * Local development only: treat requests to localhost as this admin.
   * Ignored for any other hostname, so it cannot open production.
   */
  DEV_ADMIN_EMAIL?: string;
}
