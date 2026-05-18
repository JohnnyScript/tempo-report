// AUDITORÍA (solo lectura local). Revisa días/semanas laborables sin horas
// o por debajo de 8h, usando data/tempo-existing.json (corre tempo-check antes).
//
//   node audit.mjs
//
import { readFileSync, existsSync } from 'node:fs';
import { loadEnv, loadConfig, rangeStart, isoDate } from './lib.mjs';

const env = loadEnv();
const cfg = loadConfig();
const HPD = cfg.hoursPerDay;
const START = env.SINCE || rangeStart(cfg);
const END = isoDate(new Date());

const tempo = JSON.parse(readFileSync(new URL('./data/tempo-existing.json', import.meta.url), 'utf8'));
const sec = tempo.secondsByDay || {};

const HOL = new Set(cfg.holidays);
const exPath = new URL('./data/exclude-dates.txt', import.meta.url);
if (existsSync(exPath)) for (const l of readFileSync(exPath, 'utf8').split('\n')) {
  const d = l.trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) HOL.add(d);
}

const h = (d) => (sec[d] || 0) / 3600;
function weekKey(s) {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const empty = [], partial = [], over = [], weekendWork = [];
const month = {}, week = {};
const d = new Date(START + 'T12:00:00Z');
const e = new Date(END + 'T12:00:00Z');
for (; d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
  const s = d.toISOString().slice(0, 10);
  const wd = d.getUTCDay();
  const hrs = h(s);
  if (wd === 0 || wd === 6) { if (hrs > 0) weekendWork.push(`${s}=${hrs}h`); continue; }
  if (HOL.has(s)) continue;                       // festivo: no se espera

  const m = s.slice(0, 7), wk = weekKey(s);
  const M = (month[m] ??= { work: 0, ok: 0, part: 0, empty: 0, over: 0, hrs: 0 });
  const W = (week[wk] ??= { days: 0, hrs: 0 });
  M.work++; M.hrs += hrs; W.days++; W.hrs += hrs;
  if (hrs === 0) { empty.push(s); M.empty++; }
  else if (hrs < HPD - 0.01) { partial.push(`${s}=${hrs}h`); M.part++; }
  else if (hrs > HPD + 0.01) { over.push(`${s}=${hrs}h`); M.over++; }
  else { M.ok++; }
}

console.log(`AUDITORÍA  ${START} -> ${END}  (laborables L-V, festivos de config.json excluidos)\n`);
console.log(`Mes      LV  =${HPD}h  <${HPD}h  =0h  >${HPD}h   horas`);
for (const m of Object.keys(month).sort()) {
  const x = month[m];
  console.log(`${m}  ${String(x.work).padStart(3)}  ${String(x.ok).padStart(3)}  ${String(x.part).padStart(3)}  ${String(x.empty).padStart(3)}  ${String(x.over).padStart(3)}  ${x.hrs.toFixed(0).padStart(5)}`);
}

console.log(`\nDÍAS VACÍOS (0h, laborables): ${empty.length}`);
if (empty.length) console.log('  ' + empty.join('  '));
console.log(`\nDÍAS PARCIALES (<${HPD}h): ${partial.length}`);
if (partial.length) console.log('  ' + partial.join('  '));
console.log(`\nDÍAS SOBRE ${HPD}h (registro previo, no tocado): ${over.length}`);
if (over.length) console.log('  ' + over.join('  '));

const lowWeeks = Object.entries(week)
  .map(([w, v]) => [w, v.days, v.hrs, v.days * HPD - v.hrs])
  .filter(([, , , def]) => def > 0.5)
  .sort((a, b) => b[3] - a[3]);
console.log(`\nSEMANAS CON DÉFICIT (inicio lunes · días LV · horas · faltan): ${lowWeeks.length}`);
for (const [w, days, hrs, def] of lowWeeks)
  console.log(`  ${w}  ${days}d  ${hrs.toFixed(1)}h  faltan ${def.toFixed(1)}h`);
if (weekendWork.length) console.log(`\nFin de semana con horas (info): ${weekendWork.join('  ')}`);
