---
description: Auditoría (solo lectura) de días/semanas sin horas o por debajo de la jornada
argument-hint: "[SINCE=YYYY-MM-DD opcional para mirar más atrás]"
---

Revisión SOLO LECTURA del estado de los reportes en Tempo. No escribas nada.

Alcance/extra: $ARGUMENTS

1. Ejecuta `npm run check` y luego `npm run audit` (antepón `SINCE=YYYY-MM-DD`
   si el usuario quiere mirar más atrás del rango por defecto de `config.json`).
2. Resume claramente:
   - Tabla por mes: días laborables, =jornada, <jornada, =0h, >jornada, horas.
   - Días vacíos y parciales (los que faltan por reportar).
   - Semanas con déficit.
   - Días >jornada (registro previo; señalar posibles duplicados/anomalías).
3. Si hay meses bloqueados conocidos o gaps grandes, propónle al usuario una
   estrategia (no la ejecutes aún): qué periodo probar primero, qué pedir
   reabrir, si conviene `tempo-detail.mjs` para inspeccionar días concretos.
