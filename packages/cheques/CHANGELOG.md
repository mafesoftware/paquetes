# Changelog

## 0.1.1

### Patch Changes

- Updated dependencies [0aded29]
  - @mafesoftware/fechas-ar@0.3.0

## 0.1.0

### Minor Changes

- d98e9c2: Primer release del paquete (0.1.0): cartera de cheques (propios/terceros,
  físico/echeq), extraída de Obriq (`src/lib/dominio/cheques/`).
  
  - **`transicionCheque(tipo, estado, evento)`**: estados y transiciones,
    en dos vocabularios DISJUNTOS según `tipo` — un cheque de `tercero`
    (`"en_cartera"` → `"depositado"` → `"acreditado"`/`"rechazado"`, o
    `"endosado"`/`"descontado"`/`"custodia"` desde `"en_cartera"`) y uno
    `propio` (`"en_blanco"` → `"emitido"` → `"debitado"`, con `"anular"`
    válida desde los dos primeros). Devuelve el estado siguiente o un
    `Error` (nunca tira) si la transición no es válida.
  - **`proyeccionSaldoBancario(saldoHoy, eventos, hasta)`**: el saldo de una
    cuenta bancaria proyectado hacia adelante, acumulando los cheques
    pendientes de cobrarse o debitarse hasta una fecha.
  - **`validarFechaPago`/`validarFechaDeposito`/`validarMonedaCajaValores`**:
    las reglas que corren antes de persistir un cheque o un depósito.
    `validarFechaPago`/`validarFechaDeposito` usan `diasEntre` de
    `@mafesoftware/fechas-ar` (única dependencia `@mafesoftware`: `plata-ar`
    y `documentos-ar`/`indices-ar` no aplican a esta lógica — compara
    `bigint` nativo y strings de fecha, no formatea ni valida CUIT/CBU ni
    índices de ajuste).
  
  **Núcleo puro** (regla 1 de diseño del monorepo): sin DB ni framework, sin
  `process.env`. Montos en centavos (`bigint`), nunca `number`.
  
  Sin subpath `/drizzle`: a diferencia de `@mafesoftware/numeradores` u
  `@mafesoftware/outbox`, el schema de chequeras/depósitos/cartera de Obriq
  no tiene una operación atómica reutilizable que extraer — solo tablas con
  su propio FK a `organizaciones`; queda documentado en el README como
  pendiente de cada app, no de este paquete.

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
