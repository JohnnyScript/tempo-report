---
description: Reporta tiempos de Jira en Tempo para un periodo (flujo seguro con dry-run)
argument-hint: "[mes YYYY-MM | --from YYYY-MM-DD --to YYYY-MM-DD]"
---

Vas a reportar tiempos en Tempo siguiendo el pipeline de este repo. Lee
`CLAUDE.md` para el contexto del equipo. Reglas y configuración en `config.json`.

Objetivo del usuario: $ARGUMENTS

Pasos (NO te saltes el dry-run ni la confirmación):

1. **Prep (solo lectura):** ejecuta `npm run prep` (discover + tempo-check +
   build + audit). Si hay que mirar meses antiguos, antepón `SINCE=YYYY-MM-DD`.
2. **Revisa** el resumen de `data/draft-summary.txt` y la auditoría. Reporta al
   usuario: días/horas a añadir por mes, huecos sin señal, días >8h previos.
3. **Dry-run del envío:** `npm run post -- --month <MES>` (o `--from/--to`).
   Muestra al usuario cuántas filas se crearían y cuántas se saltan.
4. **Pide confirmación explícita** antes de cualquier escritura.
5. **Envía:** `npm run post -- --month <MES> --confirm`. Empieza por UN periodo
   como prueba; si Tempo rechaza con 403 "planilla … abierto", ese periodo está
   bloqueado: avisa al usuario (hay que pedir reabrirlo), no insistas.
6. **Verifica:** re-corre `npm run check` y `npm run audit`. Si quedaron días
   <8h por colisión de anti-duplicado, `npm run fix` → dry-run → confirmar →
   `npm run post -- --file ./data/worklogs-fix.csv --confirm`.
7. Resume el resultado: creados, saltados, rechazados (bloqueo), y pendientes.

Nunca crees/borres worklogs sin mostrar antes el dry-run y obtener un sí.
