---
"@mafesoftware/fechas-ar": minor
---

Agrega la API 0.2, aditiva a la 0.1 (que sigue igual): períodos mensuales,
aritmética de meses segura para cuotas y días hábiles.

- `Periodo` (`"YYYY-MM"`) y `esPeriodo(s)` para validarlo en runtime;
  `periodoDe(fecha)` (el período de un día de calendario); `sumarPeriodos(p,
  n)` (n negativo resta, n === 0 lo devuelve igual; aritmética entera pura,
  sin límite de rango); `etiquetaPeriodo(p)` con abreviaturas de mes en
  español de tres letras minúsculas (`"2026-09"` → `"sep-2026"`).
- `sumarMeses(fecha, n, dia)`: suma (o resta, con `n` negativo) meses a una
  fecha y fija el día en `dia` (1..31, o `"ultimo"`), clamped al último día
  real del mes resultante — nunca se desborda al mes siguiente
  (`sumarMeses("2026-01-31", 1, 31)` da `"2026-02-28"`;
  `sumarMeses("2028-01-31", 1, 31)` da `"2028-02-29"`, porque 2028 es
  bisiesto).
- `esHabil(fecha, feriados)`: ni sábado/domingo ni un feriado. Los feriados
  se inyectan como `ReadonlySet<string>` (spec 06 §3.1), no están
  hardcodeados. `siguienteHabil(fecha, feriados)` devuelve la misma fecha si
  ya es hábil (documentado), si no el primer hábil posterior.
  `anteriorHabil(fecha, feriados)` es el espejo hacia atrás (agregado por
  trivial; ningún caso de uso de esta versión lo necesita).
- Todas las funciones de arriba reciben y devuelven `"YYYY-MM-DD"`/`"YYYY-MM"`
  y validan su entrada: un formato roto o un calendario imposible
  (`"2026-02-30"`) tira `ErrorFecha` con `codigo` (`"formato_invalido"` |
  `"fecha_invalida"` | `"dia_invalido"`), porque son datos que ya calculó
  otro código, no lo que tipeó una persona.
- Ningún archivo de `src/` usa `setHours`/`setUTCHours`/`getHours` (spec 02
  §6); hay un test de fuentes que lo garantiza como regresión.
- Property-based tests (fast-check): `sumarMeses` siempre da una fecha
  válida cuyo día es ≤ el día pedido; `sumarPeriodos(p, a+b) ===
  sumarPeriodos(sumarPeriodos(p, a), b)`; `siguienteHabil` siempre da un
  día hábil ≥ la fecha pedida.
- **Cambio de comportamiento en `diasEntre` (0.1), solo para entrada
  inválida**: ahora valida los dos argumentos con el mismo validador que la
  API 0.2 (`"YYYY-MM-DD"`, día de calendario real) y tira `ErrorFecha`
  (`formato_invalido`/`fecha_invalida`) si no. Antes, un formato roto daba
  `NaN` y un calendario imposible daba un conteo silenciosamente incorrecto
  (`diasEntre("2026-02-30", "2026-03-01")` daba `-1`, porque `Date.parse`
  rueda un "30 de febrero" al 2 de marzo sin avisar). Para entrada válida el
  resultado no cambia.
