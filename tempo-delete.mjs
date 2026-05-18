// BORRADO de worklogs por id (DELETE en Tempo). Destructivo.
// Dry-run por defecto; borra solo con --confirm.
//
//   node tempo-delete.mjs --ids 41244,41245,41182,40035,37222
//   node tempo-delete.mjs --ids 41244,41245 --confirm
//
import { readFileSync, existsSync } from 'node:fs';
import { loadEnv, requireEnv } from './lib.mjs';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const i = args.indexOf('--ids');
if (i < 0) { console.log('Falta --ids id1,id2,...'); process.exit(1); }
const IDS = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);

const env = loadEnv();
requireEnv(env, ['TEMPO_API_TOKEN']);

// detalle para mostrar qué es cada id (si existe)
const detPath = new URL('./data/worklogs-detail.json', import.meta.url);
const det = existsSync(detPath)
  ? new Map(JSON.parse(readFileSync(detPath, 'utf8')).map((w) => [String(w.id), w]))
  : new Map();

console.log(`Modo: ${CONFIRM ? '*** BORRADO REAL ***' : 'DRY-RUN (no borra)'}\n`);
for (const id of IDS) {
  const w = det.get(String(id));
  console.log(`  wlId ${id}  ` + (w
    ? `${w.date} ${w.hours}h ${w.issueKey} "${(w.description || '').slice(0, 50)}"`
    : '(sin detalle local)'));
}

if (!CONFIRM) { console.log('\nDRY-RUN. Repite con --confirm para borrar.'); process.exit(0); }

let ok = 0, fail = 0;
for (const id of IDS) {
  const res = await fetch(`https://api.tempo.io/4/worklogs/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.TEMPO_API_TOKEN}` },
  });
  if (res.ok || res.status === 204) { ok++; console.log(`✔ borrado ${id}`); }
  else { fail++; console.log(`ERROR ${id} -> HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 140)}`); }
  await new Promise((s) => setTimeout(s, 150));
}
console.log(`\nBorrados: ${ok}  Fallidos: ${fail}`);
