---
"@mafesoftware/planes-pago": minor
---

Primer release del paquete (0.1.0): generación y validación de planes de
pago en cuotas. Puro (sin DB, sin framework).

- **`generarCuotas`**: reparte el total de una condición en sus cuotas por
  tres sistemas — `"iguales"` (todas iguales salvo la última, que absorbe
  el redondeo), `variacion` (geométrico decreciente, repartido por mayor
  resto) o `manual` (montos y fechas a medida, validados contra `total` y
  `cuotas` antes de generar nada) — y calcula el vencimiento de cada una
  según la periodicidad (`mensual` a `anual`, o `libre` con fechas
  explícitas), movido al siguiente día hábil cuando cae en fin de semana o
  feriado.
- **`validarPlan`**: valida que la suma de las condiciones de un plan
  (convertidas a una misma moneda con el tipo de cambio pactado, si hace
  falta) cierre EXACTO contra el valor total acordado; devuelve la
  diferencia en centavos en vez de fallar en silencio.

Depende de `@mafesoftware/plata-ar` (centavos, reparto por mayor resto,
conversión de moneda) y `@mafesoftware/fechas-ar` (aritmética de meses,
día hábil siguiente).
