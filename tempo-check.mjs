// LECTURA EN TEMPO (no escribe nada). Lista tus worklogs ya registrados
// en el rango para luego evitar duplicados.
//
//   node tempo-check.mjs
//
import { writeFileSync, readFileSync } from 'node:fs';
import { loadEnv, loadConfig, requireEnv, rangeStart, isoDate } from './lib.mjs';

const env = loadEnv();
requireEnv(env, ['TEMPO_API_TOKEN']);

const me = JSON.parse(readFileSync(new URL('./data/issues.json', import.meta.url), 'utf8')).me;
const FROM = env.SINCE || rangeStart(loadConfig());
const TO = isoDate(new Date());

const headers = {
  Authorization: `Bearer ${env.TEMPO_API_TOKEN}`,
  Accept: 'application/json',
};

let url = `https://api.tempo.io/4/worklogs/user/${me.accountId}?from=${FROM}&to=${TO}&limit=1000`;
const worklogs = [];
while (url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401 ? ' -> revisa TEMPO_API_TOKEN' : '';
    throw new Error(`HTTP ${res.status} en Tempo${hint}\n${body.slice(0, 400)}`);
  }
  const data = await res.json();
  worklogs.push(...(data.results || []));
  url = data.metadata?.next || null;
  process.stdout.write(`\rWorklogs existentes: ${worklogs.length}`);
}
console.log('');

// Indexa por día y por día+issue para detectar duplicados
const byDay = {};
const byDayIssue = new Set();
let totalSeconds = 0;
for (const w of worklogs) {
  const d = w.startDate;
  byDay[d] = (byDay[d] || 0) + w.timeSpentSeconds;
  byDayIssue.add(`${d}|${w.issue?.id}`);
  totalSeconds += w.timeSpentSeconds;
}

writeFileSync(
  new URL('./data/tempo-existing.json', import.meta.url),
  JSON.stringify({ from: FROM, to: TO, count: worklogs.length,
    daysWithTime: Object.keys(byDay).sort(),
    secondsByDay: byDay,
    dayIssueKeys: [...byDayIssue] }, null, 2),
);

console.log(`Rango: ${FROM} -> ${TO}`);
console.log(`Worklogs ya en Tempo: ${worklogs.length} (${(totalSeconds / 3600).toFixed(1)} h)`);
console.log(`Días que YA tienen tiempo registrado: ${Object.keys(byDay).length}`);
const sample = Object.keys(byDay).sort().slice(-8);
if (sample.length) console.log(`Últimos días con registro: ${sample.join(', ')}`);
console.log('Guardado: data/tempo-existing.json');
