# Changelog

## 0.1.1

### Patch Changes

- Updated dependencies [f05e1fc]
- Updated dependencies [1050024]
  - @mafesoftware/fechas-ar@0.2.0
  - @mafesoftware/plata-ar@0.2.0

## 0.1.0

Motor de cuotas: recargo por mora calculado sobre el saldo con tope
(`calcularRecargo`, `totalAPagar`), estado del socio (`resumirDeuda`),
imputación de pagos a las deudas más viejas primero sin perder ni inventar un
centavo (`imputarPago`) y emisión de un período con prorrateo y descuento de
grupo familiar (`prorratear`, `emitirPeriodo`, `vencimientosDe`). Puro, sobre
`@mafesoftware/plata-ar` y `@mafesoftware/fechas-ar`.
