// PASO 2 — BORRADOR (SOLO LOCAL, no envía nada).
// Lee data/issues.json + data/tempo-existing.json y genera
// data/worklogs-draft.csv + data/draft-summary.txt para tu revisión.
//
//   node build.mjs
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

// Festivos (config.json) + opcional data/exclude-dates.txt (PTO, una fecha/línea)
const EXCLUDE = new Set(cfg.holidays);
const exPath = new URL('./data/exclude-dates.txt', import.meta.url);
if (existsSync(exPath)) {
  for (const l of readFileSync(exPath, 'utf8').split('\n')) {
    const d = l.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) EXCLUDE.add(d);
  }
}

const DAY_SECONDS = cfg.hoursPerDay * 3600;
const ACTIVE = new Set(cfg.activeDevStatuses);
const { clock } = dayClock(cfg);

// --- helpers de fechas ---
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
// Lunes-domingo de la semana ISO que contiene la fecha
function weekKey(s) {
  const d = new Date(s + 'T12:00:00Z');
  const off = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - off);
  return d.toISOString().slice(0, 10);
}

// --- reconstruir ventanas "en desarrollo" de cada tarea ---
for (const it of issues) {
  const tl = [...it.statusTimeline].sort((a, b) => a.date.localeCompare(b.date));
  const windows = [];
  let open = null;
  for (const t of tl) {
    const day = (t.date || '').slice(0, 10);
    if (ACTIVE.has(t.to) && open === null) open = day;
    else if (!ACTIVE.has(t.to) && open !== null) { windows.push([open, day]); open = null; }
  }
  if (open !== null) windows.push([open, END]);
  it._windows = windows;
  it._actInRange = it.myActivityDates.filter(inRange);
}

// índices: tareas por día (señal fuerte) y por semana
const strongByDay = {};
const tasksByWeek = {};
for (const it of issues) {
  for (const d of it._actInRange) (strongByDay[d] ??= []).push(it);
  const weeks = new Set(it._actInRange.map(weekKey));
  for (const [a, b] of it._windows) {
    // semanas que toca la ventana de desarrollo
    let c = new Date(weekKey(a > START ? a : START) + 'T12:00:00Z');
    const end = new Date(weekKey(b < END ? b : END) + 'T12:00:00Z');
    for (; c <= end; c.setUTCDate(c.getUTCDate() + 7)) weeks.add(c.toISOString().slice(0, 10));
  }
  for (const w of weeks) (tasksByWeek[w] ??= new Set()).add(it);
}

// --- reparto de tiempo de un día ---
function pickTasks(day) {
  const strong = strongByDay[day];
  if (strong?.length) return { tasks: dedupeTop(strong, day), source: 'actividad-dia' };
  const wk = tasksByWeek[weekKey(day)];
  if (wk?.size) return { tasks: dedupeTop([...wk], day), source: 'semana' };
  return { tasks: [], source: 'gap' };
}
// máx 4 tareas, priorizando las de más actividad
function dedupeTop(list, day) {
  const seen = new Map();
  for (const it of list) if (!seen.has(it.key)) seen.set(it.key, it);
  return [...seen.values()]
    .sort((a, b) => b._actInRange.length - a._actInRange.length || a.key.localeCompare(b.key))
    .slice(0, cfg.maxTasksPerDay);
}
// reparte targetMin en n tareas, múltiplos de roundingMinutes, suma exacta
function split(targetMin, n) {
  const unit = cfg.roundingMinutes;
  const slots = Math.max(1, Math.round(targetMin / unit));
  const base = Math.floor(slots / n);
  const rem = slots - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < rem ? 1 : 0)) * unit);
}

// --- generar filas ---
const rows = [];
const stats = { full: 0, gap: [], byMonth: {}, bySource: { 'actividad-dia': 0, semana: 0 } };
for (const day of workingDays()) {
  const existing = secByDay[day] || 0;
  if (existing >= DAY_SECONDS) { stats.full++; continue; }
  const targetMin = Math.round((DAY_SECONDS - existing) / 60);
  const { tasks, source } = pickTasks(day);
  const m = day.slice(0, 7);
  const ms = (stats.byMonth[m] ??= { days: 0, hours: 0, gap: 0 });
  ms.days++;
  if (tasks.length === 0) { stats.gap.push(day); ms.gap++; continue; }
  stats.bySource[source] += 1;
  const mins = split(targetMin, tasks.length);
  let off = Math.round(existing / 60); // empieza tras lo ya registrado
  tasks.forEach((it, i) => {
    rows.push({
      date: day,
      weekday: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][new Date(day + 'T12:00:00Z').getUTCDay()],
      issueKey: it.key,
      issueId: it.id,
      summary: (it.summary || '').replace(/\s+/g, ' ').slice(0, 90),
      hours: (mins[i] / 60).toFixed(2),
      startTime: clock(off),
      source,
      existingHours: (existing / 3600).toFixed(2),
    });
    off += mins[i];
    ms.hours += mins[i] / 60;
  });
}

// --- escribir CSV ---
const cols = ['date','weekday','issueKey','issueId','summary','hours','startTime','source','existingHours'];
const csv = [cols.join(',')]
  .concat(rows.map((r) => cols.map((c) => {
    const v = String(r[c] ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')))
  .join('\n');
writeFileSync(new URL('./data/worklogs-draft.csv', import.meta.url), csv + '\n');

// periodo reciente para la PRUEBA = mes calendario más reciente con filas
const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
const testMonth = months.at(-1);

// --- resumen ---
const L = [];
L.push(`Rango: ${START} -> ${END}  (L-V, sin festivos de config.json)`);
L.push(`Filas (worklogs propuestos): ${rows.length}`);
L.push(`Días ya completos (>=8h, intactos): ${stats.full}`);
L.push(`Días sin ninguna señal (HUECO, requieren tu input): ${stats.gap.length}`);
L.push(`Reparto por origen -> por día: ${stats.bySource['actividad-dia']} | por semana: ${stats.bySource['semana']}`);
L.push('');
L.push('Por mes (días trabajados / horas a añadir / huecos):');
for (const m of Object.keys(stats.byMonth).sort()) {
  const x = stats.byMonth[m];
  L.push(`  ${m}:  ${String(x.days).padStart(2)} días  ${x.hours.toFixed(1).padStart(6)} h  ${x.gap ? `(${x.gap} hueco)` : ''}`);
}
L.push('');
L.push(`PRUEBA sugerida primero -> mes ${testMonth} (${rows.filter((r) => r.date.startsWith(testMonth)).length} filas)`);
if (stats.gap.length) {
  L.push('');
  L.push('Días HUECO (sin tarea asignada, ponlos tú):');
  L.push('  ' + stats.gap.join(', '));
}
const txt = L.join('\n');
writeFileSync(new URL('./data/draft-summary.txt', import.meta.url), txt + '\n');
console.log(txt);
console.log('\nArchivos: data/worklogs-draft.csv  +  data/draft-summary.txt');
