// PASO 3 — ENVÍO A TEMPO.
// Por defecto es DRY-RUN (no envía nada). Solo envía con --confirm.
//
//   node tempo-post.mjs --month 2026-05            # simulación (dry-run)
//   node tempo-post.mjs --month 2026-05 --confirm  # envía de verdad
//   node tempo-post.mjs --from 2026-04-09 --to 2026-05-18 --confirm
//
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnv, requireEnv } from './lib.mjs';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const CONFIRM = args.includes('--confirm');
const MONTH = arg('--month');
const FROM = arg('--from');
const TO = arg('--to');
const FILE = arg('--file') || './data/worklogs-draft.csv';

const env = loadEnv();
requireEnv(env, ['TEMPO_API_TOKEN']);
const me = JSON.parse(readFileSync(new URL('./data/issues.json', import.meta.url), 'utf8')).me;
const tempo = JSON.parse(readFileSync(new URL('./data/tempo-existing.json', import.meta.url), 'utf8'));
const dup = new Set(tempo.dayIssueKeys || []);

// parse CSV (campos con comillas)
const lines = readFileSync(new URL(FILE, import.meta.url), 'utf8').trim().split('\n');
const cols = lines[0].split(',');
function parseLine(l) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return Object.fromEntries(cols.map((c, i) => [c, out[i]]));
}
let rows = lines.slice(1).map(parseLine);

// filtro de alcance
if (MONTH) rows = rows.filter((r) => r.date.startsWith(MONTH));
if (FROM) rows = rows.filter((r) => r.date >= FROM);
if (TO) rows = rows.filter((r) => r.date <= TO);
if (!rows.length) { console.log('No hay filas en ese alcance.'); process.exit(0); }

const scope = MONTH || `${FROM || lines[1]?.split(',')[0]} -> ${TO || 'fin'}`;
const totalH = rows.reduce((a, r) => a + Number(r.hours), 0);
console.log(`Modo:    ${CONFIRM ? '*** ENVÍO REAL ***' : 'DRY-RUN (no envía)'}`);
console.log(`Alcance: ${scope}`);
console.log(`Filas:   ${rows.length}  (${totalH.toFixed(1)} h)\n`);

const log = { created: [], skipped: [], locked: [], failed: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const r of rows) {
  const key = `${r.date}|${r.issueId}`;
  if (dup.has(key)) { log.skipped.push(key); continue; }
  const payload = {
    issueId: Number(r.issueId),
    timeSpentSeconds: Math.round(Number(r.hours) * 3600),
    startDate: r.date,
    startTime: r.startTime,
    description: `${r.issueKey}: ${r.summary}`.slice(0, 250),
    authorAccountId: me.accountId,
  };
  if (!CONFIRM) { log.created.push(key); continue; }

  const res = await fetch('https://api.tempo.io/4/worklogs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.TEMPO_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    log.created.push(key);
    process.stdout.write(`\rCreados: ${log.created.length}`);
  } else {
    const body = await res.text().catch(() => '');
    const blocked = /period|approved|closed|locked|submitted|planilla|per[ií]odo|aprobad|abierto|cerrad|bloquead/i.test(body);
    (blocked ? log.locked : log.failed).push({ key, status: res.status, body: body.slice(0, 200) });
  }
  await sleep(150); // amable con la API
}

console.log('\n');
console.log(`${CONFIRM ? 'Creados' : 'Se crearían'}: ${log.created.length}`);
console.log(`Saltados (ya existía ese día+tarea): ${log.skipped.length}`);
if (CONFIRM) {
  console.log(`Rechazados por periodo bloqueado: ${log.locked.length}`);
  console.log(`Otros errores: ${log.failed.length}`);
  if (log.failed.length) console.log('  ej:', JSON.stringify(log.failed[0]));
  writeFileSync(new URL('./data/post-log.json', import.meta.url), JSON.stringify(log, null, 2));
  console.log('Log: data/post-log.json');
}
