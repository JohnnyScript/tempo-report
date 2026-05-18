// PASO 1 — DESCUBRIMIENTO (SOLO LECTURA).
// No envía nada a Tempo. Solo consulta Jira y guarda el resultado en data/.
//
//   node discover.mjs
//
import { writeFileSync } from 'node:fs';
import {
  loadEnv, loadConfig, requireEnv, jiraAuthHeaders, jiraBase, jfetch,
  rangeStart, mapLimit,
} from './lib.mjs';

const env = loadEnv();
requireEnv(env, ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);

const BASE = jiraBase(env);
const HEADERS = jiraAuthHeaders(env);
const SINCE = env.SINCE || rangeStart(loadConfig());

console.log(`Jira:  ${BASE}`);
console.log(`Desde: ${SINCE}\n`);

// 1) Identidad
const me = await jfetch(`${BASE}/rest/api/3/myself`, { headers: HEADERS });
console.log(`Tú:    ${me.displayName} (${me.accountId})`);
console.log(`Zona:  ${me.timeZone}\n`);

// 2) Tareas en las que estuviste activo en el rango
const JQL =
  `(assignee = currentUser() OR assignee WAS currentUser() ` +
  `OR worklogAuthor = currentUser()) AND updated >= "${SINCE}" ORDER BY updated ASC`;

const FIELDS = ['summary', 'status', 'issuetype', 'project', 'assignee', 'created', 'updated'];

const issues = [];
let nextPageToken;
do {
  const page = await jfetch(`${BASE}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ jql: JQL, maxResults: 100, fields: FIELDS, nextPageToken }),
  });
  issues.push(...(page.issues || []));
  nextPageToken = page.nextPageToken;
  process.stdout.write(`\rTareas encontradas: ${issues.length}`);
} while (nextPageToken);
console.log(`\n`);

if (issues.length === 0) {
  console.log('No se encontraron tareas en el rango. Revisa el rango o el JQL.');
  process.exit(0);
}

// 3) Historial de cada tarea (para saber qué días estuvo activa por ti)
console.log('Descargando historial de cada tarea...');
const processed = await mapLimit(issues, 5, async (it, idx) => {
  const changelog = [];
  let startAt = 0;
  for (;;) {
    const cl = await jfetch(
      `${BASE}/rest/api/3/issue/${it.id}/changelog?startAt=${startAt}&maxResults=100`,
      { headers: HEADERS },
    );
    changelog.push(...(cl.values || []));
    if (cl.isLast || (cl.values || []).length === 0) break;
    startAt += cl.values.length;
  }

  // Días en que TÚ tocaste la tarea (entradas del historial firmadas por ti)
  const myDates = new Set();
  const statusTimeline = [];
  for (const entry of changelog) {
    const day = (entry.created || '').slice(0, 10);
    if (entry.author?.accountId === me.accountId && day) myDates.add(day);
    for (const item of entry.items || []) {
      if (item.field === 'status') {
        statusTimeline.push({
          date: entry.created,
          from: item.fromString,
          to: item.toString,
          by: entry.author?.accountId,
        });
      }
    }
  }

  process.stdout.write(`\r  ${idx + 1}/${issues.length}`);
  return {
    id: it.id,
    key: it.key,
    summary: it.fields.summary,
    type: it.fields.issuetype?.name,
    project: it.fields.project?.key,
    status: it.fields.status?.name,
    created: it.fields.created,
    updated: it.fields.updated,
    myActivityDates: [...myDates].sort(),
    statusTimeline,
  };
});
console.log('\n');

// 4) Guardar y resumir
const outPath = new URL('./data/issues.json', import.meta.url);
writeFileSync(outPath, JSON.stringify({ me, since: SINCE, issues: processed }, null, 2));

// Resumen por mes (días únicos con actividad tuya en alguna tarea)
const daysByMonth = {};
for (const it of processed) {
  for (const d of it.myActivityDates) {
    const m = d.slice(0, 7);
    (daysByMonth[m] ||= new Set()).add(d);
  }
}

console.log(`Guardado: tempo-report/data/issues.json`);
console.log(`Tareas:   ${processed.length}\n`);
console.log('Días con actividad tuya, por mes:');
for (const m of Object.keys(daysByMonth).sort()) {
  console.log(`  ${m}: ${daysByMonth[m].size} día(s)`);
}
console.log('\nMuestra (primeras 10 tareas):');
for (const it of processed.slice(0, 10)) {
  console.log(`  ${it.key.padEnd(12)} ${String(it.myActivityDates.length).padStart(3)} día(s)  ${it.summary?.slice(0, 60)}`);
}
console.log('\nListo. Revisa el resumen y seguimos con el borrador (paso 2).');
