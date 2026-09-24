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
- `repartirPorMayorResto(total, pesos)`: reparto por mayor resto (pesos como
  `bigint | number | string`), sin límite de decimales; empate en el resto
  gana el índice más bajo. Tira `ErrorPlata` con lista vacía, un peso
  negativo o todos los pesos en cero.
- `convertir(importe, moneda, tc)` y `sumar(...importes)` (tira `ErrorPlata`
  si se mezclan monedas).
- `parsearImporte(texto, opciones?)`: nunca tira, devuelve `{ ok, centavos }`
  o `{ ok, error }`. Se llama distinto de `parsearPlata` (0.1) porque la
  forma del resultado cambió de raíz.
- `formatearPlata` ahora también acepta `Importe | bigint` (sobrecarga sobre
  la firma 0.1 en `Centavos`).
- `ErrorPlata` / `CodigoErrorPlata`, para las condiciones de arriba que son
  un bug de quien llama, no un dato de usuario.
