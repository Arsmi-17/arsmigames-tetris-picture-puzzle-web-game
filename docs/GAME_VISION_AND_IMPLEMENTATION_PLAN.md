# Shape Reveal: game vision and implementation plan

Status: product plan, not a description of completed features. Updated 2026-10-21.

## What the project is

Shape Reveal is a browser game combining a picture reveal, a jigsaw-style matching goal, and falling tetromino pieces. Each four-cell piece carries the matching slice of a picture. The player moves the piece as it falls and drops it into its exact location. Correct pieces lock and reveal the image. Incorrect pieces return through a retry queue that must leave the rest of the board solvable. Pieces keep their orientation; rotation is not a player control.

The intended product is a public, mobile-friendly, endlessly replayable game. Anyone can play without an account. The game runs in the browser and will be hosted on Cloudflare. Administrators publish curated picture links through a protected page. Picture files will live on Cloudflare image storage, not in Supabase or the game repository.

### Current prototype

- React 18, TypeScript, and Vite, with a single start → play → win flow.
- Two bundled sample pictures plus a player-selected local image. The local image stays in that browser session.
- Easy 4×4 (4 pieces), Medium 8×8 (16 pieces), and Hard 10×10 (25 pieces).
- Keyboard and touch controls, hint, pause, scoring, completion time, and PNG download.
- Browser-side partition and queue generation, including checks intended to preserve a playable piece order after an incorrect drop.
- No account system, persistent progress, image catalog API, admin page, gameplay analytics, or Cloudflare deployment.

The existing code is the starting point. Preserve the falling-piece mechanic, picture-matching rule, current touch support, and puzzle solvability checks while extending it.

## Player experience

1. The player opens the public site and selects Relaxed or Arcade, or resumes a local run.
2. The game selects a picture from a published theme pack using a shuffled bag that avoids immediate repeats.
3. A short reveal or preview communicates the picture and the round's challenge.
4. Tetromino picture fragments fall. The player moves and drops them; each correct placement reveals more of the image.
5. On completion, the player sees the full picture, score or time, and progress through a short chapter. Continue should take one action.
6. After a chapter, the player receives a small milestone: a completed album page, theme change, or score recap, then can continue indefinitely.

The content library is finite, so “endless” means an ongoing run through curated pictures, shuffled packs, variable puzzle partitions, and new content published over time. Repetition must be measured; a small library alone cannot keep long-term play fresh.

## Core game rules and moods

| Rule | Relaxed | Arcade |
| --- | --- | --- |
| Objective | Finish pictures at a comfortable pace | Finish as many pictures as possible in one run |
| Falling | Slow or forgiving, with a visible landing preview | Gradually faster within tested bounds |
| Mistakes | Retry safely; no run-ending penalty | Retry safely, but reduce score or a limited mistake budget |
| Hints | Always available | Available with a score cost or limited charge |
| Run end | Player chooses when to stop | Mistake budget or player choice ends the run |
| Progress | Pictures and chapters completed | Run score, streak, pictures, and personal best |

The exact Arcade penalty should be tuned with play data. A loss must be understandable and recoverable; the player must never lose because a generated puzzle is impossible.

## Endless progression and pacing

Use chapters of approximately five pictures. Start with a familiar round, increase challenge in small increments for two or three rounds, give one peak round, then a lighter round and a chapter recap. Make the transition to the next chapter quick. Use theme packs to change the visual mood, including calm, bright, dramatic, and playful artwork, without relying only on speed changes.

Represent progress as a versioned run state: `runId`, mood, chapter, stage, picture ID, puzzle seed, challenge level, score, streak, and completed picture IDs. Save an appropriate snapshot locally so a refresh can resume. If only browser storage is used, progress will be tied to that device and browser. No player account or Supabase is planned.

### Difficulty director

The prototype jumps from 4×4 to 8×8 to 10×10. Add tested bridge steps rather than advancing a whole board size at once. Potential controls are fall interval, hint availability, picture preview duration, visual similarity of neighboring fragments, and board size. Introduce one new pressure at a time. A 6×6 board is a possible bridge only after its puzzle generation and retry ordering are proven playable; do not enable arbitrary dimensions by changing labels alone.

Use a bounded adjustment rule based on the last few rounds: completion time relative to target, incorrect drops, and hints used. Step up after repeated comfortable completions; step down or offer assistance after repeated difficulty. Keep the player's chosen mood in control of the upper and lower bounds. Every generated puzzle and retry queue must pass full remaining-run feasibility checks before it is offered.

## Picture publishing

### Administrator flow

Provide a separate protected admin page, preferably `admin.example.com`. The admin pastes a Cloudflare-hosted picture URL, adds title, theme, alt text or description, attribution/license details, optional thumbnail URL, and an intended difficulty range. The page previews the image and validates the URL, file type, size, dimensions, CORS behavior, and duplicates before publishing. Admin actions include draft, publish, unpublish, edit, reorder, and preview as a player.

There is no image upload form in the first release: the administrator uploads assets to Cloudflare separately and pastes their links. The admin page stores metadata and URLs only. Restrict accepted image hosts to the project's approved Cloudflare image domain. Never put Cloudflare write tokens in frontend code. Protect both the admin UI and every write endpoint; use Cloudflare Access or equivalent server-verified authentication.

### Storage and delivery

| Component | Purpose |
| --- | --- |
| Cloudflare Pages or Workers Static Assets | Public Vite build and admin UI assets |
| Cloudflare R2 with `images.example.com` custom domain | Full images and thumbnails, served through Cloudflare cache |
| Cloudflare D1 | Small source-of-truth catalog of picture metadata and publish state |
| Cloudflare Worker/Pages Function | Authenticated admin writes, catalog publication, and gameplay event intake |
| Public catalog JSON | Compact CDN-cached list used by the game; generated when the admin publishes changes |
| Workers Analytics Engine | Aggregate gameplay events for the retention funnel |

Do not use `r2.dev` development URLs for public production images. Configure image CORS for the game origin because the current PNG export draws the picture into a browser canvas. Use immutable or versioned image URLs for long caching. Give the public catalog a short, explicit cache policy or versioned path so admin changes appear predictably. Handle partial publish failures: an admin action should report whether both the D1 record and public catalog were updated, and be safely retryable.

Only load catalog metadata initially. Load lightweight thumbnails as they enter view and the full selected picture when a round begins. Preload at most the next likely picture during a transition. A move or drop must not call the server.

## Gameplay analytics

Cloudflare Web Analytics can cover visits and page performance. It does not currently provide custom gameplay events, so send a small, validated event payload to a Worker and aggregate it with Workers Analytics Engine. Do not log every movement or store player images, raw image URLs, names, or other personal details.

Minimum events: `run_started`, `picture_started`, `picture_completed`, `hint_used`, `run_ended`, and `client_error`. Include an anonymous temporary run ID, mode, challenge level, picture ID, chapter/stage, elapsed time, mistake count, and hint count as applicable. Rate-limit and validate the intake endpoint. Keep event volume bounded through batching where it does not hide the start of a round.

Dashboard questions:

- What fraction of visitors start a run?
- For each chapter stage and difficulty, what fraction start and complete the picture?
- Where does completion time or mistake rate jump?
- What fraction continues after a win or chapter recap?
- Do Relaxed and Arcade players return for another session?
- Which pictures are skipped, slow to load, or followed by an exit?

Treat “picture started with no later completion” as a drop-off signal, not proof of an intentional quit. Browser close events are unreliable. Use aggregated metrics to tune the game; do not automatically change difficulty thresholds based on a tiny sample.

## Request and cost model

The game simulation, scoring, puzzle generation, and local progress run in the player's browser. A session requests HTML/JS/CSS, catalog metadata, thumbnails, selected full images, and a small number of analytics submissions. Cloudflare serves the static build globally. The image custom domain permits CDN cache hits, reducing R2 origin reads. A public cached catalog avoids one database query per player. Worker invocations and D1/R2 operations still have their own quotas and prices. Measure actual traffic before choosing a paid tier.

If the entire game is on Cloudflare, Vercel does not serve these requests. Hosting only the site on Vercel while using Cloudflare image URLs shifts image requests to Cloudflare but leaves site requests on Vercel.

## Build phases and acceptance criteria

### 1. Make the existing game production-ready

- Preserve the current game and add regression coverage for puzzle generation, queue retries, win transition, pause, and mobile controls.
- Define a documented `Picture`, `Run`, `Mode`, and `Challenge` model.
- Handle failed image loads, offline/retry states, keyboard focus, reduced motion, and small viewport layout.
- Acceptance: all existing modes remain playable; generated rounds and incorrect-drop retries cannot strand the player.

### 2. Add the curated catalog and admin

- Create D1 schema, admin API, protected admin UI, URL/image validation, publish controls, and CDN catalog publication.
- Seed the existing sample art as a fallback if the catalog cannot load.
- Configure R2 custom domain, thumbnails, cache headers, and image CORS.
- Acceptance: an authorized admin can paste and publish a picture; anonymous players see it without a redeploy; anonymous users cannot modify the catalog; PNG export works with the remote picture.

### 3. Add endless runs

- Implement Relaxed and Arcade modes, chapter state machine, shuffled picture bag, local resume, run recap, and next-picture flow.
- Add small challenge steps with tested bounds and preserve solver guarantees.
- Acceptance: a player can complete several pictures without returning to setup; refresh resumes appropriately; a full picture bag reshuffles without immediate repetition.

### 4. Measure and tune

- Add gameplay event intake, aggregate dashboard queries, error monitoring, and basic load/traffic metrics.
- Run play sessions on desktop and mobile. Tune early difficulty, chapter length, hint frequency, and penalties from observed friction.
- Acceptance: the dashboard shows start-to-completion and completion-to-next-picture funnels by mood and challenge step, with no per-move requests.

### 5. Launch on Cloudflare

- Configure domains, production R2 URLs, D1 bindings, Access rules, cache behavior, build/deploy pipeline, and rollback path.
- Verify anonymous play, protected admin access, remote image export, mobile controls, and large-screen layout on the deployed site.
- Acceptance: a new picture can be published without shipping a new frontend build and a full public run works end to end.

## Deliberately outside the first release

Player accounts, cross-device save, public leaderboards, user-submitted public pictures, multiplayer, real-time sessions, and Supabase. Public leaderboards would need server-side score validation because a browser-only score is easy to alter.

## References to check when implementing

- [Cloudflare Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [R2 production public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [R2 caching](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)

Cloudflare limits and prices can change. Recheck the linked documentation before final deployment or a cost estimate.
