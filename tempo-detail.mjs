// DETALLE de worklogs por día (solo lectura). Lista cada worklog individual
// (incluye tempoWorklogId, necesario para un eventual borrado).
//
//   node tempo-detail.mjs --dates 2026-03-13,2026-01-08
//
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnv, loadConfig, requireEnv, rangeStart, isoDate } from './lib.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--dates');
const DATES = i >= 0 ? new Set(args[i + 1].split(',').map((s) => s.trim())) : null;

const env = loadEnv();
requireEnv(env, ['TEMPO_API_TOKEN']);
const cache = JSON.parse(readFileSync(new URL('./data/issues.json', import.meta.url), 'utf8'));
const me = cache.me;
const id2key = new Map(cache.issues.map((it) => [String(it.id), it.key]));

const FROM = env.SINCE || rangeStart(loadConfig());
const TO = isoDate(new Date());
const headers = { Authorization: `Bearer ${env.TEMPO_API_TOKEN}`, Accept: 'application/json' };

let url = `https://api.tempo.io/4/worklogs/user/${me.accountId}?from=${FROM}&to=${TO}&limit=1000`;
const all = [];
while (url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();
  all.push(...(data.results || []));
  url = data.metadata?.next || null;
}

const wl = all
  .filter((w) => !DATES || DATES.has(w.startDate))
  .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime));

const byDay = {};
for (const w of wl) (byDay[w.startDate] ??= []).push(w);

writeFileSync(new URL('./data/worklogs-detail.json', import.meta.url),
  JSON.stringify(wl.map((w) => ({
    id: w.tempoWorklogId, date: w.startDate, start: w.startTime,
    issueId: w.issue?.id, issueKey: id2key.get(String(w.issue?.id)) || '?',
    hours: w.timeSpentSeconds / 3600, description: w.description,
  })), null, 2));

for (const day of Object.keys(byDay).sort()) {
  const list = byDay[day];
  const tot = list.reduce((a, w) => a + w.timeSpentSeconds, 0) / 3600;
  console.log(`\n${day}  TOTAL ${tot}h  (${list.length} worklogs)`);
  for (const w of list) {
    const k = id2key.get(String(w.issue?.id)) || `id:${w.issue?.id}`;
    console.log(`  wlId ${String(w.tempoWorklogId).padEnd(8)} ${String(w.timeSpentSeconds / 3600).padStart(5)}h  ${w.startTime}  ${k.padEnd(10)} ${(w.description || '').slice(0, 60)}`);
  }
}
console.log(`\nGuardado: data/worklogs-detail.json (${wl.length} worklogs)`);
