# Shape Reveal

A picture puzzle played with falling Tetris shapes. Each piece carries the exact part of the picture that belongs on the board. Guide it into place; correct drops lock and reveal the image, while wrong drops come back in a retry order that never makes the rest of the puzzle impossible. Pieces keep their orientation; there is no rotation.

## Play

- **Relaxed** – an endless run of pictures with slower falls, a landing guide, and no penalties.
- **Arcade** – faster falls that speed up each chapter, a score with completion bonuses, hints that cost points, and five misses per run (one restored after each chapter).
- **Free play** – pick any picture and size, or use your own image. Your image is cropped in the browser and never uploaded.

Runs are paced in chapters of five pictures: a familiar start, two small steps up, one peak, then a lighter round and an album-page recap. A difficulty director moves each new chapter up or down one step based on time, misses and hints, within tested board sizes (4×4, 6×6, 8×8, 10×10). Pictures come from a shuffled bag that never repeats the previous picture.

Controls: **← →** move, **↓** soft drop, **Space** instant drop, **H** hint, **P**/**Esc** pause, or the on-screen buttons. Progress and personal bests are saved in this browser only; refreshing offers **Continue** at the current picture.

## Run locally

```sh
npm ci
npm run dev            # game only, built-in pictures, http://localhost:5173
npm run check          # typecheck (app + worker), lint, tests, production build
npm run verify:puzzles # long run: 2,000 boards per size, 500 full rounds with random misses
```

To run the full stack (catalog, admin, events) locally with Wrangler, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#local-development).

## How it fits together

| Part | Where |
| --- | --- |
| Pure game rules: seeded partition, drop physics, scoring, retry planning | `src/gameLogic.ts`, `src/engine.ts` |
| Data model (`Picture`, `Mode`, `Challenge`, `Run`) and challenge ladder | `src/model.ts`, `src/challenge.ts` |
| Endless runs: chapters, picture bag, difficulty director, local save | `src/run.ts` |
| React UI and real-time loop (gravity, clock, input) | `src/App.tsx`, `src/components/`, `src/useGameEngine.ts` |
| Catalog loading with device cache and built-in fallback | `src/catalog.ts`, `shared/catalog.ts` |
| Admin UI (`/admin/`) | `admin/index.html`, `src/admin/` |
| Pages advanced-mode worker (`dist/_worker.js`): catalog from Supabase, admin sign-in and API, event intake | `worker/src/`, `wrangler.jsonc`, `supabase/migrations/` |
| Analytics events and report | `shared/events.ts`, `src/analytics.ts`, `scripts/analytics-report.mjs` |

### Guarantees the tests hold

- Every generated board is tiled exactly by four-cell shapes and can be assembled by dropping pieces in queue order.
- After any wrong drop, the full remaining queue is simulated before the retry piece is re-inserted, so a player can never be stranded. Hundreds of seeded rounds per board size are played with random misses.
- A saved run rebuilds the same puzzle from its seed.
- Admin reads and writes are refused without a valid signed session from the env email and key; cross-origin writes are refused.
- Analytics events contain no URLs or personal data.

## Docs

- [Game vision and implementation plan](docs/GAME_VISION_AND_IMPLEMENTATION_PLAN.md)
- [Deploying](docs/DEPLOYMENT.md): Supabase setup, settings and secrets, deploy, verification, rollback
- [Gameplay analytics](docs/ANALYTICS.md): what is collected, dataset layout, dashboard queries
