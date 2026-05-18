# tempo-report

Herramienta para **reportar tiempos de Jira en Tempo** sin dolor: descubre en
qué tareas trabajaste, genera un **borrador revisable** de worklogs repartiendo
tu jornada, y los crea en Tempo **sin duplicar** lo ya registrado.

Pensada para cuando tienes que rellenar Tempo de varios días/semanas/meses hacia
atrás y hacerlo a mano sería inviable.

> **Filosofía de seguridad:** ningún script escribe en Tempo por accidente.
> Todo lo que crea o borra es **dry-run por defecto** y solo actúa con
> `--confirm`. Siempre revisas un CSV antes de enviar.

---

## Requisitos

- **Node ≥ 20** (usa `fetch` nativo; sin dependencias npm).
- Una cuenta de Jira Cloud con la app **Tempo**.
- Un **API token de Jira** y un **API token de Tempo** (ver _Setup_).

## Setup

```bash
cp .env.example .env      # rellena tus credenciales
# edita config.json con tu jornada, festivos y estados de Jira
```

`.env`:

| Variable | Qué es |
|---|---|
| `JIRA_BASE_URL` | `https://tu-empresa.atlassian.net` |
| `JIRA_EMAIL` | el correo de tu cuenta de ese Jira |
| `JIRA_API_TOKEN` | https://id.atlassian.net/manage-profile/security/api-tokens |
| `TEMPO_API_TOKEN` | Jira → Apps → Tempo → Settings → API integration |
| `SINCE` | _(opcional)_ fecha de inicio `YYYY-MM-DD`; si no, hoy − `rangeMonthsBack` |

`config.json` (se adapta a tu empresa, no toques código):

| Clave | Significado |
|---|---|
| `rangeMonthsBack` | cuántos meses atrás mirar por defecto |
| `hoursPerDay` | jornada objetivo (p.ej. 8) |
| `workdayStart`/`lunchStart`/`lunchEnd`/`workdayEnd` | horario; el almuerzo se deja libre |
| `roundingMinutes` | granularidad del reparto (p.ej. 15) |
| `maxTasksPerDay` | máximo de tareas por día en el reparto |
| `activeDevStatuses` | estados de Jira que cuentan como "trabajando" |
| `holidays` | festivos a excluir (`YYYY-MM-DD`) |

PTO/vacaciones puntuales: crea `data/exclude-dates.txt` con una fecha por línea.

---

## Flujo normal (reportar un periodo)

```bash
npm run prep                       # discover + check + build + audit (solo lectura)
# revisa data/draft-summary.txt y la auditoría
npm run post -- --month 2026-06              # DRY-RUN: qué se crearía
npm run post -- --month 2026-06 --confirm    # envía de verdad
npm run check && npm run audit               # verifica
npm run fix                                   # si quedaron días < jornada
npm run post -- --file ./data/worklogs-fix.csv --confirm
```

Mirar meses antiguos: antepón `SINCE`, p.ej. `SINCE=2025-01-01 npm run prep`.

### Comandos

| `npm run …` | Hace | ¿Escribe en Tempo? |
|---|---|---|
| `discover` | Lee Jira: tu identidad, tareas e historial → `data/issues.json` | No |
| `check` | Lee tus worklogs ya en Tempo → `data/tempo-existing.json` | No |
| `build` | Genera borrador → `data/worklogs-draft.csv` + summary | No |
| `fix` | Recompleta días por debajo de la jornada (sin colisión) | No |
| `audit` | Revisión: días/semanas vacíos, parciales, >jornada | No |
| `detail` | Lista worklogs individuales de días dados (con id) | No |
| `add` | Registro manual ad-hoc ("el día X trabajé N h en Y") | **Sí, con `--confirm`** |
| `post` | Crea los worklogs del CSV en Tempo | **Sí, con `--confirm`** |
| `delete` | Borra worklogs por id (rollback / duplicados) | **Sí, con `--confirm`** |

Pasa flags tras `--`, p.ej. `npm run post -- --month 2026-06 --confirm`.

---

## Comandos de Claude Code

Si usas [Claude Code](https://claude.com/claude-code), el repo trae slash
commands en `.claude/commands/`:

- `/tempo-report [mes]` — flujo completo guiado (con dry-run y confirmación).
- `/tempo-audit` — auditoría de huecos (solo lectura).
- `/tempo-add ...` — registro manual en lenguaje natural.

`CLAUDE.md` documenta el contexto operativo para que el agente lo siga.

---

## Cómo decide las horas

1. Para cada día laborable (L–V, sin festivos) que esté por debajo de la
   jornada, calcula lo que falta.
2. Reparte ese tiempo entre las tareas con **actividad tuya ese día** (cambios
   en el historial de Jira firmados por ti). Si no hay señal ese día, usa las
   tareas activas de **esa semana**.
3. Empaqueta las horas en el horario de `config.json`, respetando el almuerzo.
4. **Anti-duplicado:** nunca crea dos worklogs para la misma fecha+tarea, así
   que es seguro re-ejecutarlo; solo añade lo que falta.

El borrador es un CSV: revísalo/edítalo antes de `post`.

## Periodos bloqueados

Si Tempo responde `403 "El estado de la planilla de horas debe estar abierto
para el período"`, ese mes tiene el **timesheet aprobado/cerrado**: la API no
puede escribir ahí. `post` lo cuenta como _rechazado por bloqueo_ y sigue. Para
cargarlo, pide a tu manager/admin que **reabra ese periodo** y re-ejecuta.

## Privacidad

`.env` y `data/` están en `.gitignore` — credenciales y datos de Jira/Tempo
**no** se suben. El repo solo lleva código y configuración de ejemplo.

## Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| `Faltan variables en .env` | Copia `.env.example` y rellena. |
| `HTTP 401` en Jira | Revisa `JIRA_EMAIL` / `JIRA_API_TOKEN`. |
| `HTTP 404` en Jira | Revisa `JIRA_BASE_URL` (sin `/` final). |
| `403 … planilla … abierto` | Periodo bloqueado: pedir reapertura. |
| `Horas trabajadas debe ser mayor que 0` | Inofensivo: fila de 0h por reparto fino; las hermanas con tiempo sí entran. |
| Día queda < jornada tras `post` | Colisión anti-duplicado; corre `npm run fix`. |

## Licencia

MIT.
