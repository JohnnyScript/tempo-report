# CLAUDE.md — Reporte de tiempos Jira → Tempo

Guía operativa para Claude Code al trabajar en este repo. Responde en el idioma
del usuario. Las reglas (jornada, festivos, estados) viven en `config.json`.

## Propósito
Reportar en **Tempo** el tiempo invertido por tarea de Jira. Pipeline
reutilizable: lee el historial de Jira, construye un borrador de worklogs y los
crea en Tempo **sin duplicar** lo ya registrado. Suele ser una tarea recurrente.

## Entorno (no obvio)
- Credenciales en `.env` (Jira base URL, email, `JIRA_API_TOKEN`,
  `TEMPO_API_TOKEN`). Ver `.env.example`.
- **Tempo puede bloquear periodos** con timesheet aprobado: responde
  `403 "El estado de la planilla de horas debe estar abierto para el período"`
  (mensaje en español; el clasificador de `tempo-post.mjs` ya lo reconoce). Si
  un periodo está bloqueado, el usuario debe pedir a su manager/admin reabrirlo.
- Estados de Jira que cuentan como "en desarrollo": ver `activeDevStatuses` en
  `config.json`.
- API Jira: REST v3, auth Basic (`email:JIRA_API_TOKEN`). Búsqueda con
  `POST /rest/api/3/search/jql` (el viejo `/search` fue retirado).
- API Tempo: `https://api.tempo.io/4`, auth `Bearer TEMPO_API_TOKEN`.
  Crear worklog necesita el **issueId numérico** (no la key) + `authorAccountId`.

## Política de reporte (toda en `config.json`)
- Jornada y almuerzo según `workdayStart/lunchStart/lunchEnd/workdayEnd`;
  objetivo `hoursPerDay`, solo L–V, excluyendo `holidays` (+ `data/exclude-dates.txt` para PTO).
- Reparto del tiempo de un día:
  1. Tareas con **actividad del usuario ese día** (changelog firmado por él) → reparto entre ellas.
  2. Si no hay señal ese día → reparto entre tareas activas de **esa misma semana**.
  3. Días parciales → **completar solo el faltante**, sin tocar lo previo.
  4. **Anti-duplicado:** nunca crear dos worklogs misma fecha+issue.
- Máx. `maxTasksPerDay` tareas/día, en bloques de `roundingMinutes`.
- **Nada se envía/borra en Tempo sin confirmación explícita del usuario.**
  `tempo-post.mjs`, `add.mjs` y `tempo-delete.mjs` son dry-run por defecto;
  solo actúan con `--confirm`.

## Pipeline (Node ≥20, sin dependencias)
| Script | Qué hace | Escribe en Tempo |
|---|---|---|
| `discover.mjs` | Lee Jira: identidad + tareas + historial → `data/issues.json` | No |
| `tempo-check.mjs` | Lee worklogs ya existentes → `data/tempo-existing.json` (anti-dup) | No |
| `build.mjs` | Genera borrador → `data/worklogs-draft.csv` + `draft-summary.txt` | No |
| `build-fix.mjs` | Rellena días por debajo de la jornada sin colisionar | No |
| `tempo-post.mjs` | Crea los worklogs en Tempo | **Sí, solo con `--confirm`** |
| `add.mjs` | Registro manual ad-hoc ("el día X trabajé N h en Y") | **Sí, solo con `--confirm`** |
| `audit.mjs` | Revisión: días/semanas vacíos, parciales o > jornada | No |
| `tempo-detail.mjs` | Lista worklogs individuales de días dados (con id) | No |
| `tempo-delete.mjs` | Borra worklogs por id (rollback / dups) | **Sí, solo con `--confirm`** |
| `lib.mjs` | Utilidades comunes (config, auth, paginación, errores) | — |

`tempo-post.mjs` flags: `--month YYYY-MM` · `--from`/`--to YYYY-MM-DD` ·
`--file <csv>` (default `data/worklogs-draft.csv`) · `--confirm` (sin él = dry-run).

## Receta: reportar un periodo
```bash
npm run prep                                  # discover+check+build+audit (lectura)
# revisar data/draft-summary.txt y la auditoría
npm run post -- --month 2026-06               # DRY-RUN
# tras OK del usuario:
npm run post -- --month 2026-06 --confirm
npm run check && npm run audit                # verificar
npm run fix                                   # si quedaron días < jornada
npm run post -- --file ./data/worklogs-fix.csv --confirm   # tras OK
```
Rango por defecto: hoy − `rangeMonthsBack` (config). Para mirar más atrás,
anteponer `SINCE=YYYY-MM-DD` (la var de entorno pisa el `.env`).

## Registro manual ad-hoc (`add.mjs`)
Para "el día X trabajé N horas en la tarea Y" (incluye fines de semana / horas
extra; salta las reglas de jornada/festivos).
```bash
npm run add -- --entry "2026-05-16|ABC-123|4|13:00"            # DRY-RUN
npm run add -- --entry "2026-05-16|ABC-123|4|13:00" --confirm  # tras OK
```
Formato `--entry`: `FECHA|ISSUE|HORAS|[INICIO]|[DESC]`. `INICIO` por defecto
`13:00`. Resuelve el issueId solo. Si ya existe ese día+tarea lo salta salvo
`--force`. Siempre dry-run salvo `--confirm`.

## Auditoría y limpieza
```bash
npm run check && npm run audit                 # ¿huecos / >jornada / déficit?
npm run detail -- --dates 2026-03-13,...       # detalle por día (id)
npm run delete -- --ids 41244,41245            # dry-run; +--confirm borra
```
Patrón de duplicado accidental: mismo issueId + mismas horas + startTime a
segundos/minutos. Conservar la entrada con más info (p.ej. link de MR).
Borrar es destructivo (revertir = recrear). Siempre dry-run + OK del usuario.

## Gotchas
- Si el faltante de un día es muy pequeño y se reparte entre varias tareas,
  alguna fila puede quedar en 0h → Tempo la rechaza ("Horas trabajadas debe ser
  mayor que 0"). Inofensivo: las hermanas con tiempo sí entran.
- `myActivityDates` puede traer fechas fuera del rango (historial viejo de
  tareas solo "actualizadas" hace poco); `build.mjs` ya las acota al rango.
- Tras borrar duplicados, días pueden bajar de la jornada: re-correr
  `tempo-check` + `build-fix`.
