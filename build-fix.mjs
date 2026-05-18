// ARREGLO de días < 8h. Rellena el faltante con tareas que NO estén ya
// registradas ese día (evita colisión con el anti-duplicado).
// Genera data/worklogs-fix.csv  (no envía nada).
//
//   node build-fix.mjs
//
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadEnv, loadConfig, rangeStart, dayClock, isoDate } from './lib.mjs';

const env = loadEnv();
const cfg = loadConfig();
const START = env.SINCE || rangeStart(cfg);
const END = isoDate(new Date());

const { issues } = JSON.parse(readFileSync(new URL('./data/issues.json', import.meta.url), 'utf8'));
const tempo = JSON.parse(readFileSync(new URL('./data/tempo-existing.json', import.meta.url), 'utf8'));
const secByDay = tempo.secondsByDay || {};
const loggedDayIssue = new Set(tempo.dayIssueKeys || []); // "YYYY-MM-DD|issueId"

const EXCLUDE = new Set(cfg.holidays);
const exPath = new URL('./data/exclude-dates.txt', import.meta.url);
if (existsSync(exPath)) {
  for (const l of readFileSync(exPath, 'utf8').split('\n')) {
    const d = l.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) EXCLUDE.add(d);
  }
}

const { dayMinutes: DAY_MIN, clock } = dayClock(cfg);
const ACTIVE = new Set(cfg.activeDevStatuses);
const inRange = (d) => d >= START && d <= END;

function* workingDays() {
  const d = new Date(START + 'T12:00:00Z');
  const e = new Date(END + 'T12:00:00Z');
  for (; d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    const s = d.toISOString().slice(0, 10);
    if (wd >= 1 && wd <= 5 && !EXCLUDE.has(s)) yield s;
  }
}
function weekKey(s) {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

for (const it of issues) {
  const tl = [...it.statusTimeline].sort((a, b) => a.date.localeCompare(b.date));
  const windows = []; let open = null;
  for (const t of tl) {
    const day = (t.date || '').slice(0, 10);
    if (ACTIVE.has(t.to) && open === null) open = day;
    else if (!ACTIVE.has(t.to) && open !== null) { windows.push([open, day]); open = null; }
  }
  if (open !== null) windows.push([open, END]);
  it._windows = windows;
  it._actInRange = it.myActivityDates.filter(inRange);
}

const strongByDay = {};
const tasksByWeek = {};
for (const it of issues) {
  for (const d of it._actInRange) (strongByDay[d] ??= []).push(it);
  const weeks = new Set(it._actInRange.map(weekKey));
  for (const [a, b] of it._windows) {
    let c = new Date(weekKey(a > START ? a : START) + 'T12:00:00Z');
    const end = new Date(weekKey(b < END ? b : END) + 'T12:00:00Z');
    for (; c <= end; c.setUTCDate(c.getUTCDate() + 7)) weeks.add(c.toISOString().slice(0, 10));
  }
  for (const w of weeks) (tasksByWeek[w] ??= new Set()).add(it);
}

// candidatos del día que NO estén ya registrados ese día
function candidates(day) {
  const free = (list) => {
    const seen = new Map();
    for (const it of list || []) {
      if (loggedDayIssue.has(`${day}|${it.id}`)) continue;
      if (!seen.has(it.key)) seen.set(it.key, it);
    }
    return [...seen.values()]
      .sort((a, b) => b._actInRange.length - a._actInRange.length || a.key.localeCompare(b.key))
      .slice(0, cfg.maxTasksPerDay);
  };
  let c = free(strongByDay[day]);
  if (!c.length) c = free([...(tasksByWeek[weekKey(day)] || [])]);
  return c;
}
function split(targetMin, n) {
  const unit = cfg.roundingMinutes;
  const slots = Math.max(1, Math.round(targetMin / unit));
  const base = Math.floor(slots / n), rem = slots - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < rem ? 1 : 0)) * unit);
}

const rows = [];
const noTask = [];
let shortDays = 0;
for (const day of workingDays()) {
  const sec = secByDay[day] || 0;
  if (sec <= 0) continue;                 // los días a cero ya se trataron
  const remMin = DAY_MIN - Math.round(sec / 60);
  if (remMin < cfg.roundingMinutes) continue;   // ya está completo
  shortDays++;
  const tasks = candidates(day);
  if (!tasks.length) { noTask.push(day); continue; }
  const mins = split(remMin, tasks.length);
  let off = Math.round(sec / 60);
  tasks.forEach((it, i) => {
    rows.push({
      date: day,
      weekday: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][new Date(day + 'T12:00:00Z').getUTCDay()],
      issueKey: it.key, issueId: it.id,
      summary: (it.summary || '').replace(/\s+/g, ' ').slice(0, 90),
      hours: (mins[i] / 60).toFixed(2),
      startTime: clock(off), source: 'fix', existingHours: (sec / 3600).toFixed(2),
    });
    off += mins[i];
  });
}

const cols = ['date','weekday','issueKey','issueId','summary','hours','startTime','source','existingHours'];
const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => {
  const v = String(r[c] ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(','))).join('\n');
writeFileSync(new URL('./data/worklogs-fix.csv', import.meta.url), csv + '\n');

const days = new Set(rows.map((r) => r.date));
const h = rows.reduce((a, r) => a + Number(r.hours), 0);
console.log(`Días cortos detectados: ${shortDays}`);
console.log(`Días que se rellenan:   ${days.size}  (+${h.toFixed(1)} h en ${rows.length} filas)`);
if (noTask.length) console.log(`Sin tarea libre (a mano): ${noTask.join(', ')}`);
console.log('Archivo: data/worklogs-fix.csv');
