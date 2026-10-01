---
"@mafesoftware/conciliacion": minor
---

Primer release del paquete (0.1.0): conciliación bancaria argentina en dos
piezas independientes.

- **Parseo de extractos** (`parsearExtracto`/`detectarBanco`): CSV/XLSX/PDF
  de 6 bancos (Galicia, Santander, BBVA, Macro, Nación, Provincia) a líneas
  normalizadas (`fecha` ISO, `importe`/`saldo` en centavos `bigint` con
  signo), más `parsearConMapeo` genérico (columnas por nombre, no por
  posición) para cuando hace falta un mapeo manual.
- **Motor de sugerencia de matches** (`sugerirMatches`): cruza esas líneas
  contra los movimientos conciliables del sistema que integra el paquete,
  por tres reglas en orden de certeza decreciente — `referencia_cuit`
  (importe + CUIT de la contraparte en la descripción), `importe_fecha`
  (importe exacto, único candidato dentro de la tolerancia) y
  `combinacion` (suma exacta de 2..N movimientos del mismo signo,
  `buscarCombinacion` con DFS podado). `clasificarSoloExtracto` clasifica
  una línea sin contraparte (impuesto, comisión, interés bancario) por
  patrón de texto.

**Núcleo puro** (regla 1 de diseño del monorepo): el matching
(`sugerir.ts`/`combinaciones.ts`/`clasificar.ts`) no hace I/O de ningún
tipo; el parseo de archivo (`exceljs`/`pdfjs-dist`) queda aislado en sus
propios módulos. Dependencias normales (no inyectadas): este paquete no
habla con ningún servicio externo, solo lee el formato que declara cada
banco.

Extraído de Obriq (`src/lib/dominio/conciliacion/` y
`src/lib/extractos/`), donde ya era núcleo puro por diseño (sin `@/db`,
`next` ni nada de la app).
