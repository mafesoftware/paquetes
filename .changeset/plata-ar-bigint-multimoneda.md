---
"@mafesoftware/plata-ar": minor
---

Agrega la API 0.2 en `bigint`, aditiva a la 0.1 (que queda `@deprecated` pero
sigue funcionando):

- `Importe` (`{ centavos: bigint; moneda: Moneda }`) y `Moneda` (`"ARS" |
  "USD" | "EUR"`).
- `redondearComercial(num, den)`: redondeo medio hacia arriba, alejándose de
  cero, en `bigint` puro.
- `aplicarFactor(centavos, factor)`: factores decimales de hasta 8 decimales
  (spec 02 §3.2), sin punto flotante.
- `factorEntre(valorRef, valorBase)`: la razón exacta entre dos valores de
  índice (acepta cualquier cantidad de decimales en la entrada, a diferencia
  de `aplicarFactor`), redondeada comercial a 8 decimales (`bigint` puro).
  Los índices son positivos: tira `ErrorPlata` (`indice_invalido`) si
  `valorRef`/`valorBase` no son mayores a 0, o no son un decimal válido.
- `repartirPorMayorResto(total, pesos)`: reparto por mayor resto (pesos como
  `bigint | number | string`, incluida notación exponencial en los
  `number`), sin límite de decimales; **empate en el resto → gana el peso
  más grande; empate también en el peso → el índice más bajo** (spec 02
  §1). Un `-0` cuenta como cero, no como negativo. Tira `ErrorPlata` con
  lista vacía, un peso negativo o todos los pesos en cero.
- `convertir(importe, moneda, tc)`: `tc` tiene que ser mayor a 0 (si no,
  `ErrorPlata` `tc_no_positivo`), y convertir a la misma moneda de origen
  exige `tc === "1"` (si no, `ErrorPlata` `tc_identidad`). El round trip
  (`convertir` ida y vuelta) cae dentro de ±1 centavo **solo** cuando el TC
  y su inverso son recíprocos exactos y se arranca en la moneda fuerte — no
  es una garantía general con dos cotizaciones cargadas por separado.
- `sumar(...importes)` (tira `ErrorPlata` si se mezclan monedas, o si se
  llama sin importes).
- `parsearImporte(texto, opciones?)`: nunca tira, devuelve `{ ok, centavos }`
  o `{ ok, error }`. Se llama distinto de `parsearPlata` (0.1) porque la
  forma del resultado cambió de raíz. Formato es-AR **estricto** por
  defecto: un punto SIEMPRE es separador de miles (debe agrupar de a 3
  dígitos exactos; `"1.50"`/`"1234.56"` son inválidos) — `opciones.
  decimalConPunto: true` habilita la convención en inglés (responsabilidad
  de quien llama: en ese modo `"1.000"` es 1 peso, no mil). Solo tolera
  dígitos, un `-` inicial, `.`, `,`, espacios y símbolos/códigos de moneda
  (`$`, `US$`, `U$S`, `ARS`, `USD`, `EUR`, `€`) — y el signo/token únicamente
  como prefijo o sufijo alrededor del número, nunca metidos adentro de los
  dígitos: `"1e3"`, `"(500)"`, `"1$2"` y `"12 ARS 34"` son inválidos, no se
  leen a pedazos.
- `formatearPlata` ahora también acepta `Importe | bigint` (sobrecarga sobre
  la firma 0.1 en `Centavos`), con aritmética `bigint` exacta más allá de
  `Number.MAX_SAFE_INTEGER` centavos y agrupamiento/separadores del locale
  real (vía un string decimal exacto a `Intl.NumberFormat`, no una
  reimplementación a mano que asume grupos de a 3 en todos lados).
  `opciones.moneda` no tiene efecto cuando se pasa un `Importe` (la moneda la
  trae el propio importe).
- `ErrorPlata` / `CodigoErrorPlata`, para las condiciones de arriba que son
  un bug de quien llama, no un dato de usuario (agrega `tc_no_positivo`,
  `tc_identidad` e `indice_invalido`).
