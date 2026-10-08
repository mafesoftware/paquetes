---
"@mafesoftware/devengados": minor
---

Primer release del paquete (0.1.0): obligaciones que se devengan por mes y se
cancelan con pagos (sueldos, alquileres, acuerdos de sponsor, cuotas).

- **`cuotasVencidas` / `devengadoAl`**: las cuotas ya vencidas a un día dado
  (una por mes, desde el inicio o el corte de migración hasta la baja, cada una
  con el monto vigente de su mes) y el total devengado, sumando lo previo al
  corte. Un mes sin vigencia no devenga (no se inventa un 0).
- **`montoVigente`**: el monto que rige en un período entre varias vigencias
  (el alquiler sube, el sueldo se actualiza).
- **`estadoSaldo`**: `sin_deuda` / `pendiente` / `parcial` / `saldada` /
  `pagado_de_mas` según devengado y pagado.
- **`matrizPorPeriodo`**: la tabla dinámica fila × período con totales por
  fila, por período y general.
- **`periodoDeFecha` / `primerDia` / `periodosEntre`**: utilidades de períodos
  `"YYYY-MM"` sobre `@mafesoftware/fechas-ar`.

Núcleo puro (el "hoy" entra por parámetro), plata en centavos `bigint`.
Extraído de bocaunidos (`src/lib/dominio/devengados.ts`) con la misma API y
semántica; suma validación de entradas con errores que dicen qué campo falla
(un `hasta` inválido en `periodosEntre` ya no puede colgar el loop) y
property-based tests (monotonía de `devengadoAl`, cuadre de la matriz,
totalidad de `estadoSaldo`).
