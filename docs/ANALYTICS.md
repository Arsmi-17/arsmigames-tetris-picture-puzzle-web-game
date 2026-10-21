# Gameplay analytics

**Turning it on:** Analytics Engine is off by default. Enable it once in the Cloudflare dashboard (**Workers & Pages → Analytics Engine**), then uncomment `analytics_engine_datasets` in `wrangler.jsonc` and deploy. Until then, the game still sends events and the server accepts them, but nothing is stored.

Shape Reveal sends a few anonymous events per picture to `POST /api/events`. The Worker validates them and writes one data point each to the Workers Analytics Engine dataset `shape_reveal_events`. Visits and page performance come from Cloudflare Web Analytics, which is enabled separately in the dashboard.

## What is sent

| Event | When | Fields |
| --- | --- | --- |
| `run_started` | A Relaxed or Arcade run begins | mode, runId, level, visit (`first` or `returning` for this browser) |
| `picture_started` | A round's preview ends and play begins (including after resume) | mode, runId, pictureId, level, chapter, stage |
| `picture_completed` | The last piece locks | as above, plus seconds, mistakes, hints, score |
| `hint_used` | Hints are switched on | mode, runId, pictureId, level |
| `run_ended` | Arcade misses run out, or the player chooses End run | mode, runId, reason, chapter, stage, pictures, score |
| `client_error` | Uncaught error, failed picture load, or catalog unavailable | errorKind, short scrubbed message, pictureId when relevant |

Free play rounds use `mode: "free"` and no run id.

Not sent: individual moves, player names, image URLs, the player's own image or its filename, IP addresses, or any persistent device identifier. The run id is random for each run. The `visit` flag is a yes/no stored in the player's browser. Error messages have URLs and email addresses removed and are cut to 120 characters. The Worker rejects any picture id that is not a catalog-style slug, so URLs cannot be stored even by a modified client.

### Delivery and limits

- `run_started` and `picture_started` are sent immediately, so a quick exit still counts as a start. Other events are batched for up to 10 seconds and flushed with `navigator.sendBeacon` when the page is hidden.
- At most 20 events per request and 8 KB per body. Requests from other origins are rejected.
- The `EVENTS_LIMITER` Rate Limiting binding allows 60 requests per minute per IP address. The IP address is only the limiter key and is never written. Without the binding, a per-isolate fallback applies.
- Local development (`npm run dev`) sends nothing. Production builds send events unless built with `VITE_ANALYTICS=off`.
- If the endpoint is down, play continues normally and events are dropped.

## Dataset columns

Written in `worker/src/events.ts` (`toDataPoint`):

| Column | Meaning |
| --- | --- |
| index1, blob1 | event name |
| blob2 | mode (`relaxed`, `arcade`, `free`) |
| blob3 | picture id |
| blob4 | run id |
| blob5 | run end reason, or client error kind |
| blob6 | visit (`first` / `returning`) |
| blob7 | scrubbed error message |
| double1 | 1 (count) |
| double2 | challenge level |
| double3 | chapter |
| double4 | stage (0–4) |
| double5 | seconds |
| double6 | mistakes |
| double7 | hints |
| double8 | score |
| double9 | pictures completed in the run |

Missing numbers are written as `-1`. Analytics Engine samples at high volume, so weight every count by `_sample_interval`.

## Report

```sh
CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run analytics:report -- 14   # last 14 days
node scripts/analytics-report.mjs --print                          # print the SQL only
```

The token needs **Account Analytics: Read**. The queries answer the plan's dashboard questions:

| Question | Query |
| --- | --- |
| What fraction of visitors start a run? | *Runs started per day*, divided by Web Analytics visits for the same days |
| Per stage and difficulty, how many start and finish a picture? | *Start → completion by mode, chapter stage and challenge level* |
| Where do completion time or mistakes jump? | *Completion time and mistakes by level* |
| Who continues after a win or a chapter recap? | *Continue after a win and after a chapter recap* |
| Do Relaxed and Arcade players come back? | *Returning players by mode* |
| Which pictures are slow, failing, or abandoned? | *Pictures: starts, completions, load failures, time* |

How to read the results:

- A started picture with no completion is a drop-off signal, not proof that the player chose to quit. Closing the tab is not reported reliably.
- *Continue rate* counts every later `picture_started` in a run, so resumes after a refresh and skipped pictures also count as continuing.
- Tune thresholds from trends over enough runs. A few dozen rounds is too few to move the difficulty director or the Arcade budget.

These queries use the Analytics Engine SQL dialect but have not been run against a live dataset yet. Check them once real events exist.
