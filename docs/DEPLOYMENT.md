# Deploying Shape Reveal to Cloudflare

The site is a Cloudflare Pages project (`arsmigames-tetris-picture-puzzle-web-game`). `npm run build` writes the game to `dist/` and bundles `worker/src` into `dist/_worker.js`, Pages' advanced mode. That worker receives every request: it serves the public `/catalog.json`, anonymous event intake at `/api/events`, and the admin page and API under `/admin/` and `/api/admin/`, and hands everything else to the static files. Picture files live in a separate public R2 bucket behind an image custom domain.

```
Player ──► <project>.pages.dev ──► _worker.js ──► static assets (dist/)
                                   ├──► /catalog.json ◄── R2 shape-reveal-catalog (private)
                                   └──► /api/events ───► Analytics Engine
Admin ──► Cloudflare Access ──► <project>.pages.dev/admin/ ──► _worker.js (JWT re-checked) ──► D1 + R2 catalog
Player ──► images.example.com ──► R2 shape-reveal-images (public, CDN cached)
```

The backend has **not** been deployed yet. Everything below needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment (or `npx wrangler login`). The token needs edit access to Pages, D1, R2 and Access. The picture domain needs a zone on Cloudflare. Replace `example.com` with your domain, and recheck Cloudflare's limits and prices before launch.

## 1. Create the resources

```sh
npx wrangler d1 create shape-reveal-catalog          # copy database_id into wrangler.jsonc
npx wrangler r2 bucket create shape-reveal-catalog   # private: generated catalog JSON only
npx wrangler r2 bucket create shape-reveal-images    # public pictures
```

Picture bucket (`shape-reveal-images`):

1. In the dashboard, open **R2 → shape-reveal-images → Settings → Custom Domains** and connect `images.example.com`. Keep the `r2.dev` public URL disabled; the admin rejects `r2.dev` links.
2. Edit the origins in `infra/r2-images-cors.json`, then apply it:
   `npx wrangler r2 bucket cors set shape-reveal-images --file infra/r2-images-cors.json`.
   PNG export draws the picture into a canvas, which needs CORS. The admin page is on the same origin, so its in-browser check uses the same rule.
3. Add a Cache Rule for `images.example.com` that marks requests eligible for cache and respects the origin's cache headers.

Upload pictures with versioned names and long cache lifetimes. Pictures must be square, at least 512×512, JPEG, PNG or WebP, and at most 5 MB. About 1600×1600 is plenty.

```sh
npx wrangler r2 object put shape-reveal-images/pictures/lake-v1.jpg --file lake.jpg \
  --content-type image/jpeg --cache-control "public, max-age=31536000, immutable" --remote
```

To change a picture, upload it under a new name (`lake-v2.jpg`) and edit the URL in the admin. Never overwrite a cached URL.

The Analytics Engine dataset `shape_reveal_events` is created on its first write. Pages has no Rate Limiting binding, so `/api/events` uses the worker's built-in per-isolate limit.

## 2. Protect the admin with Cloudflare Access

1. In **Zero Trust → Access → Applications**, add a **Self-hosted** application:
   - Destinations: `<project>.pages.dev/admin` and `<project>.pages.dev/api/admin` (add the same two paths on any custom domain). Check the Access [application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) documentation to confirm subpaths are covered.
   - Policy: **Allow**, with the administrators' emails or an identity-provider group.
2. Copy the application's **Audience (AUD) tag** and your team domain (`<team>.cloudflareaccess.com`).

The Worker does not rely on Access alone. On every `/admin` and `/api/admin` request it verifies the `Cf-Access-Jwt-Assertion` signature against your team's public keys and checks audience, issuer and expiry. Missing configuration means every admin request is refused. Admin writes must also come from the same origin and use JSON bodies.

## 3. Configure `wrangler.jsonc`

| Setting | Value |
| --- | --- |
| `d1_databases[0].database_id` | from `wrangler d1 create` |
| `vars.ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `vars.ACCESS_AUD` | the Access application's AUD tag |
| `vars.ADMIN_EMAILS` | optional comma list, a second allowlist after Access |
| `vars.IMAGE_HOSTS` | `images.example.com` (comma list if you need more) |
| `vars.GAME_ORIGIN` | the site's origin, e.g. `https://<project>.pages.dev`; used to check image CORS and accept events |

Pages reads these bindings and variables from `wrangler.jsonc` on deploy. A custom domain for the game is added under **Workers & Pages → the project → Custom domains**.

None of these are secrets. The Worker uses bindings for D1 and R2, so no Cloudflare API token reaches the browser. Never set `DEV_ADMIN_EMAIL` in production. It only works for `localhost` requests, but it belongs in `.dev.vars` (see `.dev.vars.example`).

## 4. Migrate and deploy

```sh
npm ci
npm run db:migrate:remote      # creates the catalog tables in D1
npm run deploy                 # typecheck, lint, tests, build, then wrangler pages deploy --branch main
```

If the Pages project is also connected to GitHub, set its build command to `npm run build` and output directory to `dist`, so Git builds include `_worker.js` too.

Then enable **Web Analytics** for the site in the dashboard, for visit counts.

Until the first picture is published, `/catalog.json` returns 404 and players see the built-in sample pictures.

## 5. Verify the live site

Check these by hand after each production deploy:

- [ ] `https://<project>.pages.dev/` loads on a phone and a large screen. The controls stay reachable above the home indicator.
- [ ] `https://<project>.pages.dev/api/admin/me` from a private window returns 401. `https://<project>.pages.dev/admin/` shows the Access login.
- [ ] After signing in, the admin lists pictures. Add a picture by URL; **Check image** shows the server and browser checks passing.
- [ ] Publish it. Within about a minute, `https://<project>.pages.dev/catalog.json` includes it, and a new Relaxed run can draw it without a redeploy.
- [ ] Finish a round with that picture and **Download completed picture**. The PNG must contain the image (proves CORS).
- [ ] Refresh mid-run and **Continue**. Play several pictures through a chapter recap.
- [ ] Unpublish the picture; it leaves the catalog.
- [ ] Workers Analytics Engine receives events: `npm run analytics:report -- 1` (see [ANALYTICS.md](ANALYTICS.md)).

## Rollback

| What | How |
| --- | --- |
| Game and worker (deployed together) | `npx wrangler pages deployment list`, then **Rollback** on an earlier deployment under Workers & Pages → the project → Deployments |
| Public catalog | Fix the entry in the admin and press **Republish**, or restore an earlier copy: every publication is also stored as `catalog/v<N>.json`. `npx wrangler r2 object get shape-reveal-catalog/catalog/v12.json --file v12.json --remote`, then put it back as `catalog/catalog.json` with `--content-type application/json` |
| Catalog database | D1 Time Travel: `npx wrangler d1 time-travel restore shape-reveal-catalog --timestamp=<ISO time>`, then **Republish** |
| Pictures | Old versioned files stay in R2; point the entry back at the previous URL |

The game always keeps working: if `/catalog.json` is unavailable, players get the last catalog cached on their device, or the built-in pictures.

## Local development

```sh
npm run dev                    # game only, Vite, built-in pictures, no analytics
cp .dev.vars.example .dev.vars # set DEV_ADMIN_EMAIL for local admin access
npm run db:migrate:local
npm run worker:dev             # build + full site with local D1/R2 at http://localhost:8788
```

The admin is then at `http://localhost:8788/admin/`. Image checks still fetch the real image host, so use URLs on a host listed in `IMAGE_HOSTS`.

## Still needed before launch

- A Cloudflare account and zone, real hostnames, and the values in section 3.
- The image bucket's custom domain, CORS and cache rule, and the first curated pictures with clear usage rights.
- The Access application and policy.
- Playtesting on real phones to tune the ladder, chapter pacing and the Arcade miss budget (see [ANALYTICS.md](ANALYTICS.md)).
