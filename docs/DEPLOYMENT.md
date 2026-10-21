# Deploying Shape Reveal

The site is a Cloudflare Pages project (`arsmigames-tetris-picture-puzzle-web-game`). `npm run build` writes the game to `dist/` and bundles `worker/src` into `dist/_worker.js` (Pages advanced mode). That worker receives every request:

| Path | What it does |
| --- | --- |
| `/catalog.json` | Published pictures, read from Supabase and cached for 60 seconds |
| `/api/events` | Anonymous gameplay events into Workers Analytics Engine |
| `/admin/` | Admin page; shows a sign-in form until the admin signs in |
| `/api/admin/login` | Checks the email and key against `ADMIN_EMAIL` / `ADMIN_KEY` and sets a signed session cookie |
| `/api/admin/*` | Picture management; needs the session cookie |
| everything else | The game's static files |

Pictures are image links pasted into the admin; the files stay wherever they are hosted. Supabase holds the catalog in the tables from `supabase/migrations/`.

## 1. Supabase

1. In the Supabase dashboard, open **SQL Editor**, paste `supabase/migrations/20261021000000_mg_tetris_reveal_game.sql`, and run it. It is safe to run again.
2. From **Project Settings → API**, copy the **Project URL** and the **service_role** key.

The tables are `mg-tetris-reveal-game` (pictures), `mg-tetris-reveal-game_publications` and `mg-tetris-reveal-game_audit_log`. The names contain hyphens, so quote them in SQL: `select * from public."mg-tetris-reveal-game";`. Row level security lets anonymous users read only published pictures and only their public columns. All writes go through the worker with the service_role key, which never reaches the browser.

## 2. Configuration

Plain settings live in `wrangler.jsonc` under `vars`:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | the Supabase Project URL, e.g. `https://abcd1234.supabase.co` |
| `GAME_ORIGIN` | the site's origin, `https://arsmigames-tetris-picture-puzzle-web-game.pages.dev` |
| `IMAGE_HOSTS` | empty to accept image links from any https website, or a comma list of allowed hosts |

Secrets are set on the Pages project, never in a file in the repository:

```sh
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler pages secret put ADMIN_EMAIL
npx wrangler pages secret put ADMIN_KEY          # at least 4 characters
```

They can also be added in the dashboard under **Workers & Pages → the project → Settings → Variables and Secrets** (type: Secret). Changing `ADMIN_KEY` signs out every admin session.

Without `ADMIN_EMAIL` and an `ADMIN_KEY` of at least 4 characters, nobody can sign in. Without the Supabase settings, `/catalog.json` returns 503 and players get the pictures saved on their device or the built-in ones.

## 3. Deploy

```sh
npm ci
npm run deploy      # typecheck, lint, tests, build, then wrangler pages deploy --branch main
```

This needs `CLOUDFLARE_API_TOKEN` (with **Cloudflare Pages: Edit** on the account) and `CLOUDFLARE_ACCOUNT_ID` in the environment, or `npx wrangler login`.

If the Pages project is connected to GitHub, set its build command to `npm run build` and the output directory to `dist`, so Git builds include `_worker.js`.

## 4. Check the live site

- [ ] The game loads on a phone and a large screen.
- [ ] `/api/admin/me` in a private window returns 401; `/admin/` shows the sign-in form; a wrong key is refused.
- [ ] After signing in, add a picture by URL. **Check image** passes, both on the server and in the browser.
- [ ] Publish it. `/catalog.json` includes it within a minute, and a new Relaxed run can draw it.
- [ ] Finish a round with it and **Download completed picture**. The PNG must contain the image. This needs the image host to send CORS headers.
- [ ] Unpublish it; it leaves the catalog within a minute.
- [ ] Events arrive: `npm run analytics:report -- 1` (see [ANALYTICS.md](ANALYTICS.md)).

## Rollback

| What | How |
| --- | --- |
| Game and worker (deployed together) | `npx wrangler pages deployment list`, then **Rollback** on an earlier deployment under Workers & Pages → the project → Deployments |
| Catalog data | Supabase backups / point-in-time recovery, or fix the entry in the admin |

## Local development

```sh
npm run dev                    # game only, built-in pictures, no analytics
cp .dev.vars.example .dev.vars # fill in the Supabase and admin values
npm run worker:dev             # full site at http://localhost:8788, admin at /admin/
```

Wrangler's local server reads `.dev.vars` instead of the `vars` in `wrangler.jsonc`, so put every variable there. `.dev.vars` is git-ignored.
