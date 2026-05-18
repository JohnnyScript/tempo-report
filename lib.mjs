// Utilidades compartidas. Sin dependencias externas (Node 22 trae fetch).
import { readFileSync } from 'node:fs';

// Carga .env de forma simple (KEY=VALOR por línea, ignora comentarios)
export function loadEnv(path = new URL('./.env', import.meta.url)) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error('No existe el archivo .env. Copia .env.example a .env y rellénalo.');
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  // Una variable de entorno real tiene prioridad sobre el .env
  // (permite p.ej. `SINCE=2025-01-01 node audit.mjs` sin tocar el .env)
  for (const k of ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'TEMPO_API_TOKEN', 'SINCE']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

export function requireEnv(env, keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Faltan variables en .env: ${missing.join(', ')}`);
  }
}

// Cabeceras de autenticación Basic para Jira Cloud
export function jiraAuthHeaders(env) {
  const basic = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

export function jiraBase(env) {
  return env.JIRA_BASE_URL.replace(/\/+$/, '');
}

// fetch con mensajes de error legibles
export async function jfetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    const hint =
      res.status === 401 ? ' -> revisa JIRA_EMAIL / JIRA_API_TOKEN' :
      res.status === 403 ? ' -> el token no tiene permisos suficientes' :
      res.status === 404 ? ' -> revisa JIRA_BASE_URL' :
      res.status === 410 ? ' -> endpoint retirado (script desactualizado)' : '';
    throw new Error(`HTTP ${res.status} en ${url}${hint}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// --- Configuración (config.json) ---
const CONFIG_DEFAULTS = {
  rangeMonthsBack: 6,
  hoursPerDay: 8,
  workdayStart: '08:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  workdayEnd: '17:00',
  roundingMinutes: 15,
  maxTasksPerDay: 4,
  activeDevStatuses: ['In Progress'],
  holidays: [],
};

export function loadConfig(path = new URL('./config.json', import.meta.url)) {
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  return { ...CONFIG_DEFAULTS, ...cfg };
}

export function hhmmToMin(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

// Inicio del rango = hoy menos rangeMonthsBack meses (o SINCE en .env/env)
export function rangeStart(cfg = CONFIG_DEFAULTS) {
  const d = new Date();
  d.setMonth(d.getMonth() - (cfg.rangeMonthsBack ?? 6));
  return isoDate(d);
}
export const sixMonthsAgo = () => rangeStart();

// Mapea un offset (min trabajados desde el inicio) a "HH:MM:SS",
// saltando el hueco del almuerzo. Derivado de config.
export function dayClock(cfg) {
  const ws = hhmmToMin(cfg.workdayStart);
  const ls = hhmmToMin(cfg.lunchStart);
  const le = hhmmToMin(cfg.lunchEnd);
  const we = hhmmToMin(cfg.workdayEnd);
  const morning = ls - ws;            // min disponibles antes del almuerzo
  const dayMinutes = morning + (we - le);
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  const clock = (off) => fmt(Math.min(off < morning ? ws + off : le + (off - morning), we));
  return { dayMinutes, clock };
}

// Limita la concurrencia de promesas (para no saturar la API de Jira)
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
