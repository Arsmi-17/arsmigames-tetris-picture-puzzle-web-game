# Deploying Shape Reveal to Cloudflare

One Worker serves everything: the game's static build, the public `/catalog.json`, anonymous event intake at `/api/events`, and the admin page and API under `/admin/` and `/api/admin/`. Picture files live in a separate public R2 bucket behind an image custom domain.

```
Player ──► play.example.com ──► Worker ──► static assets (dist/)
                                   ├──► /catalog.json ◄── R2 shape-reveal-catalog (private)
                                   └──► /api/events ───► Analytics Engine
Admin ──► Cloudflare Access ──► admin.example.com/admin/ ──► Worker (JWT re-checked) ──► D1 + R2 catalog
Player ──► images.example.com ──► R2 shape-reveal-images (public, CDN cached)
```

This repository has **not** been deployed. Everything below needs a Cloudflare account, a zone for your domain, and `npx wrangler login`. Replace `example.com` with your domain throughout, and recheck Cloudflare's limits and prices before launch.

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
   PNG export draws the picture into a canvas, which needs CORS. The admin origin is listed so the editor's in-browser check can pass.
3. Add a Cache Rule for `images.example.com` that marks requests eligible for cache and respects the origin's cache headers.

Upload pictures with versioned names and long cache lifetimes. Pictures must be square, at least 512×512, JPEG, PNG or WebP, and at most 5 MB. About 1600×1600 is plenty.

```sh
npx wrangler r2 object put shape-reveal-images/pictures/lake-v1.jpg --file lake.jpg \
  --content-type image/jpeg --cache-control "public, max-age=31536000, immutable" --remote
```

To change a picture, upload it under a new name (`lake-v2.jpg`) and edit the URL in the admin. Never overwrite a cached URL.

The Analytics Engine dataset `shape_reveal_events` is created on its first write. The `EVENTS_LIMITER` rate limit's `namespace_id` can be any integer string that is unique in your account.

## 2. Protect the admin with Cloudflare Access

1. In **Zero Trust → Access → Applications**, add a **Self-hosted** application:
   - Destinations: `admin.example.com` (the whole host). To protect the paths on the public host too, add `play.example.com/admin` and `play.example.com/api/admin`. Check the Access [application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) documentation to confirm subpaths are covered.
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
| `vars.GAME_ORIGIN` | `https://play.example.com`, used to check image CORS and accept events |
| `routes` | uncomment and set `play.example.com` and `admin.example.com` |

None of these are secrets. The Worker uses bindings for D1 and R2, so no Cloudflare API token reaches the browser. Never set `DEV_ADMIN_EMAIL` in production. It only works for `localhost` requests, but it belongs in `.dev.vars` (see `.dev.vars.example`).

## 4. Migrate and deploy

```sh
npm ci
npm run db:migrate:remote      # creates the catalog tables in D1
npm run deploy                 # typecheck, lint, tests, build, then wrangler deploy
```

Then enable **Web Analytics** for `play.example.com` in the dashboard, for visit counts.

Until the first picture is published, `/catalog.json` returns 404 and players see the built-in sample pictures.

## 5. Verify the live site

Check these by hand after each production deploy:

- [ ] `https://play.example.com/` loads on a phone and a large screen. The controls stay reachable above the home indicator.
- [ ] `https://play.example.com/api/admin/me` from a private window returns 401. `https://admin.example.com/admin/` shows the Access login.
- [ ] After signing in, the admin lists pictures. Add a picture by URL; **Check image** shows the server and browser checks passing.
- [ ] Publish it. Within about a minute, `https://play.example.com/catalog.json` includes it, and a new Relaxed run can draw it without a redeploy.
- [ ] Finish a round with that picture and **Download completed picture**. The PNG must contain the image (proves CORS).
- [ ] Refresh mid-run and **Continue**. Play several pictures through a chapter recap.
- [ ] Unpublish the picture; it leaves the catalog.
- [ ] Workers Analytics Engine receives events: `npm run analytics:report -- 1` (see [ANALYTICS.md](ANALYTICS.md)).

## Rollback

| What | How |
| --- | --- |
| Worker code and static assets (deployed together) | `npx wrangler deployments list`, then `npx wrangler rollback <version-id>` |
| Public catalog | Fix the entry in the admin and press **Republish**, or restore an earlier copy: every publication is also stored as `catalog/v<N>.json`. `npx wrangler r2 object get shape-reveal-catalog/catalog/v12.json --file v12.json --remote`, then put it back as `catalog/catalog.json` with `--content-type application/json` |
| Catalog database | D1 Time Travel: `npx wrangler d1 time-travel restore shape-reveal-catalog --timestamp=<ISO time>`, then **Republish** |
| Pictures | Old versioned files stay in R2; point the entry back at the previous URL |

The game always keeps working: if `/catalog.json` is unavailable, players get the last catalog cached on their device, or the built-in pictures.

## Local development

```sh
npm run dev                    # game only, Vite, built-in pictures, no analytics
cp .dev.vars.example .dev.vars # set DEV_ADMIN_EMAIL for local admin access
npm run db:migrate:local
npm run worker:dev             # build + full Worker with local D1/R2 at http://localhost:8787
```

The admin is then at `http://localhost:8787/admin/`. Image checks still fetch the real image host, so use URLs on a host listed in `IMAGE_HOSTS`.

## Still needed before launch

- A Cloudflare account and zone, real hostnames, and the values in section 3.
- The image bucket's custom domain, CORS and cache rule, and the first curated pictures with clear usage rights.
- The Access application and policy.
- Decide whether `admin.example.com` gets its own route (recommended) or the admin stays under `/admin` on the public host.
- Playtesting on real phones to tune the ladder, chapter pacing and the Arcade miss budget (see [ANALYTICS.md](ANALYTICS.md)).
