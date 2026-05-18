---
description: Registro manual ad-hoc de horas ("el día X trabajé N h en la tarea Y")
argument-hint: "<fecha> <ISSUE> <horas> [hora inicio] — o descríbelo en lenguaje natural"
---

Registro manual de worklogs en Tempo con `add.mjs`. Soporta fines de semana y
horas extra (salta las reglas de jornada/festivos).

Lo que pidió el usuario: $ARGUMENTS

1. Interpreta fecha(s), ISSUE(s) (clave Jira tipo ABC-123), horas y hora de
   inicio. Si falta el inicio, por defecto es la tarde (13:00). Si falta la
   tarea o es ambigua, **pregunta** antes de continuar.
2. **Dry-run:** `npm run add -- --entry "FECHA|ISSUE|HORAS|INICIO"` (un
   `--entry` por línea/tarea). Muestra al usuario lo que se registraría.
3. Pide confirmación.
4. **Envía:** repite el comando añadiendo `--confirm`.
5. Verifica con `npm run check` y confirma el total del día al usuario.

Nunca envíes sin dry-run + OK explícito.
