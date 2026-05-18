// REGISTRO MANUAL ad-hoc. "El día X trabajé N horas en la tarea Y".
// Dry-run por defecto; envía solo con --confirm.
//
//   node add.mjs --entry "2026-05-16|ABC-123|4|13:00"
//   node add.mjs --entry "2026-05-16|ABC-123|4|13:00|trabajo en la tarde" \
//                --entry "2026-05-17|ABC-456|4|13:00" --confirm
//
// Formato de --entry:  FECHA|ISSUE|HORAS|[INICIO]|[DESCRIPCION]
//   FECHA   YYYY-MM-DD   ISSUE  clave Jira (ABC-123)   HORAS  número
//   INICIO  HH:MM (opc, por defecto 13:00 = tarde)     DESCRIPCION (opc)
//
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadEnv, requireEnv, jiraAuthHeaders, jiraBase, jfetch } from './lib.mjs';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const FORCE = args.includes('--force');
const entries = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--entry') entries.push(args[++i]);
if (!entries.length) { console.log('Falta al menos un --entry "FECHA|ISSUE|HORAS|[INICIO]|[DESC]"'); process.exit(1); }

const env = loadEnv();
requireEnv(env, ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'TEMPO_API_TOKEN']);
const BASE = jiraBase(env);
const HEADERS = jiraAuthHeaders(env);

const cache = JSON.parse(readFileSync(new URL('./data/issues.json', import.meta.url), 'utf8'));
const me = cache.me;
const byKey = new Map(cache.issues.map((it) => [it.key, { id: it.id, summary: it.summary }]));

const existPath = new URL('./data/tempo-existing.json', import.meta.url);
const dup = existsSync(existPath)
  ? new Set(JSON.parse(readFileSync(existPath, 'utf8')).dayIssueKeys || [])
  : new Set();

async function resolveIssue(key) {
  if (byKey.has(key)) return byKey.get(key);
  const it = await jfetch(`${BASE}/rest/api/3/issue/${key}?fields=summary`, { headers: HEADERS });
  const r = { id: it.id, summary: it.fields?.summary || '' };
  byKey.set(key, r);
  return r;
}
function pad(s) { return String(s).padStart(2, '0'); }
function normTime(t) {
  if (!t) return '13:00:00';
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) throw new Error(`Hora inválida: "${t}" (usa HH:MM)`);
  return `${pad(m[1])}:${m[2]}:${m[3] || '00'}`;
}
const WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const rows = [];
for (const raw of entries) {
  const [date, key, hoursS, startS, ...descRest] = raw.split('|').map((x) => x?.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error(`Fecha inválida en: ${raw}`);
  if (!key) throw new Error(`Falta ISSUE en: ${raw}`);
  const hours = Number(hoursS);
  if (!(hours > 0)) throw new Error(`Horas inválidas en: ${raw}`);
  const issue = await resolveIssue(key);
  const desc = (descRest.join('|') || `${key}: ${issue.summary}`).slice(0, 250);
  const wd = WD[new Date(date + 'T12:00:00Z').getUTCDay()];
  const dupKey = `${date}|${issue.id}`;
  rows.push({
    date, weekday: wd, issueKey: key, issueId: issue.id,
    summary: issue.summary, hours: hours.toFixed(2),
    startTime: normTime(startS), description: desc,
    isDup: dup.has(dupKey),
  });
}

console.log(`Modo: ${CONFIRM ? '*** ENVÍO REAL ***' : 'DRY-RUN (no envía)'}\n`);
for (const r of rows) {
  console.log(`  ${r.date} (${r.weekday})  ${r.issueKey.padEnd(10)} ${r.hours}h @ ${r.startTime}` +
    `  ${r.isDup ? '⚠ YA EXISTE ese día+tarea' : ''}\n    ${r.description}`);
}

// registro local del lote
const cols = ['date', 'weekday', 'issueKey', 'issueId', 'summary', 'hours', 'startTime', 'description'];
const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => {
  const v = String(r[c] ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(','))).join('\n');
writeFileSync(new URL('./data/worklogs-manual.csv', import.meta.url), csv + '\n');

if (!CONFIRM) {
  console.log('\nDRY-RUN. Repite con --confirm para enviar a Tempo.');
  process.exit(0);
}

let created = 0, skipped = 0;
for (const r of rows) {
  if (r.isDup && !FORCE) { skipped++; console.log(`Saltado (dup, usa --force): ${r.date} ${r.issueKey}`); continue; }
  const res = await fetch('https://api.tempo.io/4/worklogs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TEMPO_API_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      issueId: Number(r.issueId),
      timeSpentSeconds: Math.round(Number(r.hours) * 3600),
      startDate: r.date, startTime: r.startTime,
      description: r.description, authorAccountId: me.accountId,
    }),
  });
  if (res.ok) { created++; console.log(`✔ ${r.date} ${r.issueKey} ${r.hours}h`); }
  else { const b = await res.text().catch(() => ''); console.log(`ERROR ${r.date} ${r.issueKey} -> HTTP ${res.status} ${b.slice(0, 160)}`); }
  await new Promise((s) => setTimeout(s, 150));
}
console.log(`\nCreados: ${created}  Saltados: ${skipped}`);
