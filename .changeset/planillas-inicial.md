---
"@mafesoftware/planillas": minor
---

Primer release del paquete (0.1.0): motor genérico de **importación** de
planillas `.xlsx` y de **exportación** `.csv`/`.xlsx`, para toda pantalla de
importación/exportación de los productos de MAFE Software.

- **Importación** (`leerMatriz` → `mapearColumnas` → `filasDesdeMatriz` →
  `previsualizar`): lee la primera hoja de un `.xlsx` (una celda numérica se
  convierte a texto con coma decimal, formato argentino), mapea columnas
  **desordenadas** por alias con `mapeoManual` opcional que gana siempre,
  valida fila por fila con un `validador` puro que **nunca aborta** el resto
  del archivo (`errores` lleva el número de fila y el motivo), y separa
  `nuevas` de `yaImportadas` por **clave natural** — un duplicado dentro del
  mismo archivo o ya existente no es un error, se omite.
- **Exportación** (`filasACsv`/`filasAExcel`): `.csv` con separador `;`, BOM
  UTF-8 por default (Excel en Windows rompe acentos sin él) y
  **anti-inyección de fórmulas** por default — una celda de texto que
  arranque con `=`/`+`/`-`/`@` (inyección de fórmulas CSV/Excel, CWE-1236) se
  neutraliza anteponiendo un apóstrofo, sin tocar nunca un valor numérico
  (un monto negativo no es una fórmula). `.xlsx` de una sola hoja con
  `exceljs`.

**Núcleo puro** (regla 1 de diseño del monorepo): sin `process.env`, sin
ninguna dependencia de framework — `exceljs` es una dependencia normal (no
inyectada), porque este paquete no habla con ningún servicio externo, solo
lee/escribe el formato `.xlsx`.

Extraído de Obriq (`src/lib/importar/motor.ts` y `src/lib/exportar/`), donde
ya era núcleo puro por diseño (sin `@/db`, `next` ni nada de la app).
