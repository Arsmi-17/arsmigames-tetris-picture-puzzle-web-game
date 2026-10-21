# Implementation prompt

Copy the prompt below into a coding assistant working in this repository. Read [GAME_VISION_AND_IMPLEMENTATION_PLAN.md](GAME_VISION_AND_IMPLEMENTATION_PLAN.md) with it.

```text
You are working in the existing Shape Reveal React/TypeScript/Vite repository. First inspect the current source, README, package scripts, git status, and any repository instructions. Read docs/GAME_VISION_AND_IMPLEMENTATION_PLAN.md as the product brief. Preserve unrelated working-tree changes.

Goal: turn the current single-picture prototype into a polished, public, endlessly replayable falling-tetromino picture-reveal game hosted on Cloudflare. A player guides falling picture fragments into exact matching positions. Correct placements reveal the picture; incorrect pieces retry without making the remaining puzzle impossible. Keep this core mechanic, keyboard and touch controls, hint, pause, and PNG download. Do not add rotation. Do not add Intuit branding or Supabase.

Implement in reviewable phases, completing and verifying each phase before moving on:
1. Refactor game data/state so pictures come from a typed catalog rather than only the current hardcoded array. Keep the bundled sample pictures as an offline/failure fallback. Handle remote-image loading and CORS failures clearly.
2. Build a protected admin experience for pasting Cloudflare-hosted picture URLs, previewing them, entering title/theme/attribution/difficulty metadata, and publishing, editing, ordering, or unpublishing entries. Images are uploaded to Cloudflare separately; this admin page stores URLs and metadata, not picture bytes. Protect the UI and all write APIs. Validate approved hosts and image suitability. Never expose Cloudflare credentials to the browser.
3. Use Cloudflare D1 as the catalog source of truth and publish a compact CDN-cacheable public catalog JSON when entries change. Use a Cloudflare R2 custom domain for production image links and configure CORS so the result PNG download works. Make failed or partial publishing visible and retryable.
4. Add an endless run loop with Relaxed and Arcade moods, five-picture chapter pacing, shuffled picture selection without immediate repeats, one-action continuation, local browser resume, and personal bests. Increase challenge gradually. Do not enable a new board size until its puzzle generation and full remaining-queue feasibility are tested.
5. Add lightweight gameplay analytics: run/picture starts, completions, hints, run end, and client errors. Send bounded, validated events to a Cloudflare Worker and aggregate with Workers Analytics Engine. No event on every move, no personal data, and no raw image URLs in events. Provide queries or a small dashboard for stage completion and continue rates.
6. Prepare Cloudflare deployment configuration and instructions for public site, protected admin, images, bindings, domains, caching, and rollback. If credentials and domains are not available, leave deployment ready and clearly list the exact external setup still needed; do not claim a live deployment.

Design for phones first, with fixed reachable controls and safe-area support. Preserve reduced-motion behavior. Keep the game playable when catalog or analytics services are temporarily unavailable. Treat local progress as device-specific because there are no accounts.

Verify meaningful paths: solver and retry feasibility over many seeds, admin authentication and anonymous write rejection, catalog publication and refresh, remote-image canvas export, chapter transitions and no-repeat selection, resume after refresh, mobile controls, and a production build. Report what changed, what was actually tested, remaining external Cloudflare configuration, and any known limitations. Do not claim browser, deployed, or live-service verification unless it was performed.
```
