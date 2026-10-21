#!/usr/bin/env node
/**
 * Shape Reveal gameplay report from Workers Analytics Engine.
 *
 *   CF_ACCOUNT_ID=... CF_API_TOKEN=... node scripts/analytics-report.mjs [days]
 *   node scripts/analytics-report.mjs --print     # just print the SQL
 *
 * The token needs the "Account Analytics: Read" permission. Column layout is
 * documented in docs/ANALYTICS.md and written by worker/src/events.ts.
 * Counts are weighted by _sample_interval because Analytics Engine samples
 * at high volume.
 */

const DATASET = 'shape_reveal_events';
const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 7);
const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
const n = (cond) => `SUM(IF(${cond}, _sample_interval, 0))`;

export const QUERIES = {
  'Runs started per day (compare with Web Analytics visits for the start rate)': `
    SELECT toStartOfDay(timestamp) AS day, blob2 AS mode, ${n("blob1 = 'run_started'")} AS runs_started
    FROM ${DATASET} WHERE ${since} AND blob1 = 'run_started'
    GROUP BY day, mode ORDER BY day, mode`,

  'Start → completion by mode, chapter stage and challenge level': `
    SELECT blob2 AS mode, double4 AS stage, double2 AS level,
      ${n("blob1 = 'picture_started'")} AS started,
      ${n("blob1 = 'picture_completed'")} AS completed,
      round(completed / started, 3) AS completion_rate
    FROM ${DATASET} WHERE ${since} AND blob1 IN ('picture_started', 'picture_completed') AND blob2 != 'free'
    GROUP BY mode, stage, level ORDER BY mode, level, stage`,

  'Completion time and mistakes by level (where friction jumps)': `
    SELECT blob2 AS mode, double2 AS level,
      SUM(_sample_interval) AS pictures,
      round(SUM(_sample_interval * double5) / SUM(_sample_interval), 1) AS avg_seconds,
      round(SUM(_sample_interval * double6) / SUM(_sample_interval), 2) AS avg_mistakes,
      round(SUM(_sample_interval * double7) / SUM(_sample_interval), 2) AS avg_hints
    FROM ${DATASET} WHERE ${since} AND blob1 = 'picture_completed'
    GROUP BY mode, level ORDER BY mode, level`,

  'Continue after a win and after a chapter recap': `
    SELECT blob2 AS mode,
      ${n("blob1 = 'picture_completed'")} AS completed,
      ${n("blob1 = 'picture_started' AND NOT (double3 = 1 AND double4 = 0)")} AS next_started,
      round(next_started / completed, 3) AS continue_rate,
      ${n("blob1 = 'picture_completed' AND double4 = 4")} AS chapters_finished,
      ${n("blob1 = 'picture_started' AND double4 = 0 AND double3 > 1")} AS next_chapter_started,
      round(next_chapter_started / chapters_finished, 3) AS recap_continue_rate
    FROM ${DATASET} WHERE ${since} AND blob1 IN ('picture_completed', 'picture_started') AND blob2 != 'free'
    GROUP BY mode`,

  'Returning players by mode (this browser has started a run before)': `
    SELECT blob2 AS mode, blob6 AS visit, ${n("blob1 = 'run_started'")} AS runs
    FROM ${DATASET} WHERE ${since} AND blob1 = 'run_started'
    GROUP BY mode, visit ORDER BY mode, visit`,

  'How runs end': `
    SELECT blob2 AS mode, blob5 AS reason, SUM(_sample_interval) AS runs,
      round(SUM(_sample_interval * double9) / SUM(_sample_interval), 1) AS avg_pictures,
      round(SUM(_sample_interval * double8) / SUM(_sample_interval), 0) AS avg_score
    FROM ${DATASET} WHERE ${since} AND blob1 = 'run_ended'
    GROUP BY mode, reason`,

  'Pictures: starts, completions, load failures, time': `
    SELECT blob3 AS picture,
      ${n("blob1 = 'picture_started'")} AS started,
      ${n("blob1 = 'picture_completed'")} AS completed,
      ${n("blob1 = 'client_error' AND blob5 = 'image_load'")} AS load_failures,
      round(SUM(IF(blob1 = 'picture_completed', _sample_interval * double5, 0)) / completed, 1) AS avg_seconds
    FROM ${DATASET} WHERE ${since} AND blob3 != ''
    GROUP BY picture ORDER BY started DESC LIMIT 50`,

  'Client errors': `
    SELECT blob5 AS kind, blob7 AS message, SUM(_sample_interval) AS count
    FROM ${DATASET} WHERE ${since} AND blob1 = 'client_error'
    GROUP BY kind, message ORDER BY count DESC LIMIT 30`,
};

async function run(sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}` },
    body: `${sql.trim()} FORMAT JSON`,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).data;
}

if (printOnly) {
  for (const [title, sql] of Object.entries(QUERIES)) console.log(`-- ${title}\n${sql.trim()};\n`);
} else {
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) {
    console.error('Set CF_ACCOUNT_ID and CF_API_TOKEN, or pass --print to see the SQL.');
    process.exit(1);
  }
  console.log(`Shape Reveal, last ${days} days\n`);
  for (const [title, sql] of Object.entries(QUERIES)) {
    console.log(`## ${title}`);
    try {
      console.table(await run(sql));
    } catch (error) {
      console.error(`  failed: ${error.message}`);
    }
  }
}
