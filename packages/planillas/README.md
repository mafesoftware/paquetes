# @mafesoftware/planillas

Motor genérico de **importación** de planillas `.xlsx` (mapeo de columnas
desordenadas, validación fila por fila sin abortar, idempotencia por clave
natural) y de **exportación** `.csv`/`.xlsx` (separador `;`, BOM UTF-8,
anti-inyección de fórmulas) — para toda pantalla de importación/exportación
de los productos de MAFE Software.

Extraído de Obriq (`src/lib/importar/motor.ts` y `src/lib/exportar/`), donde
ya era **núcleo puro** por diseño: sin `@/db`, sin `next`, sin ninguna
dependencia de la app — solo `exceljs`.

Parte de la familia de paquetes de MAFE Software: **núcleo puro** en el
sentido de la regla 1 de diseño del monorepo — sin `process.env`, sin
framework. `exceljs` es una dependencia normal (no inyectada): este paquete
no habla con ningún servicio externo, solo lee/escribe el formato `.xlsx`.

```bash
bun add @mafesoftware/planillas
```

Ningún error de validación se tira: `validarFilas` nunca aborta por una fila
mala, `mapearColumnas` devuelve los campos faltantes en vez de tirar. La
única función que puede rechazar el archivo entero es `leerMatriz`, y solo
propaga lo que ya tira `exceljs` al parsear un `.xlsx` corrupto.

## API

### Importación

El flujo típico de una pantalla de importación, en orden:

```
archivo (.xlsx)
  → leerMatriz            (I/O: encabezado + filas de texto crudo)
  → mapearColumnas         (encabezado real → índice, columnas desordenadas)
  → filasDesdeMatriz        (matriz + índices → FilaCruda[])
  → previsualizar           (validarFilas + separarPorClaveNatural)
  → [confirma] insertar `nuevas`
```

#### `leerMatriz(archivo: Uint8Array | ArrayBuffer): Promise<MatrizArchivo>`

Lee la primera hoja de un `.xlsx` (fila 1 = encabezado). Puro I/O: no valida
ni mapea nada.

```ts
type MatrizArchivo = {
  encabezado: string[];
  filas: string[][]; // SIEMPRE texto — una celda vacía es "", nunca null
};
```

Una celda **numérica** de Excel se convierte a texto en formato argentino
(coma decimal, sin separador de miles): `1234.56` → `"1234,56"`. Es a
propósito — `String(1234.56)` da `"1234.56"`, indistinguible de un texto
tipeado "a la inglesa" para un parser que siempre lee el punto como
separador de miles salvo que se le diga lo contrario (como
`parsearNumeroAR`/`parsearImporte` de `@mafesoftware/plata-ar`). Convertir
acá, una sola vez, deja un string sin ningún punto que ese parser ya sabe
leer bien.

#### `mapearColumnas(encabezadoArchivo, columnasEsperadas, mapeoManual?): ResultadoMapeo`

Encuentra el índice real de cada columna esperada en el encabezado del
archivo **sin asumir un orden fijo** ("columnas desordenadas"). Compara
ignorando mayúsculas, tildes y espacios repetidos.

```ts
type ColumnaEsperada = {
  campo: string; // nombre lógico — la clave que usa tu `validador`
  alias: readonly string[]; // encabezados aceptados, tal cual pueden venir escritos
  obligatoria?: boolean; // default true
};

type ResultadoMapeo = {
  indices: Record<string, number>; // campo → índice de columna (0-based)
  faltantes: string[]; // obligatorios que no se encontraron
};
```

`mapeoManual` (campo lógico → encabezado EXACTO del archivo) gana siempre a
los alias automáticos — es lo que usa una pantalla cuando el archivo trae un
encabezado que no matchea ningún alias conocido.

```ts
mapearColumnas(
  ["Descripción", "Código"],
  [
    { campo: "codigo", alias: ["código", "code"] },
    { campo: "nombre", alias: ["nombre", "descripción"] },
  ],
);
// { indices: { nombre: 0, codigo: 1 }, faltantes: [] }
```

#### `filasDesdeMatriz(matrizDatos, indices): FilaCruda[]`

Arma `FilaCruda[]` (`{ campo: texto }`, siempre `string`) a partir de la
matriz de datos (sin encabezado) y el `indices` de `mapearColumnas`.

#### `validarFilas(filas, validador): ResultadoValidacion<T>`

Valida cada fila con un `validador` **puro** que tu dominio provee, y que
nunca tira:

```ts
type Validador<T> = (
  fila: FilaCruda,
  numeroFila: number,
) => { ok: true; datos: T } | { ok: false; error: string };
```

Una fila con error queda en `errores` **con su número y motivo** — nunca
aborta la importación entera. `numeroFila` es base 1 + 1 por el encabezado,
así coincide con el número de fila que el usuario ve en Excel.

```ts
type ResultadoValidacion<T> = {
  validas: { fila: number; datos: T }[];
  errores: { fila: number; error: string }[];
};
```

#### `separarPorClaveNatural(validas, claveDe, clavesExistentes?): ClasificacionIdempotente<T>`

Separa `nuevas` de `yaImportadas` por **clave natural** (ej. unidad =
proyecto+código, índice = "índice:período"). `clavesExistentes` la arma tu
dominio consultando lo que ya existe. Un duplicado **dentro del mismo
archivo** (fila repetida, o reimportar el mismo archivo dos veces) también
queda en `yaImportadas` — primera aparición gana, y **no es un error**.

#### `previsualizar(filas, validador, claveDe, clavesExistentes?): VistaPrevia<T>`

La vista previa completa que ve el usuario antes de confirmar:
`validarFilas` + `separarPorClaveNatural` en un solo resultado. "Importar
solo válidas" = insertar `nuevas`.

### Exportación

#### `filasACsv(encabezados, filas, opciones?): string`

Arma un `.csv` con separador `;` (el que abre directo en Excel/Sheets
configurados en español, donde `,` es el decimal).

```ts
type OpcionesCsv = {
  bom?: boolean; // default true
  antiInyeccion?: boolean; // default true
};

filasACsv(["Código", "Nombre"], [["1", "Cemento"]]);
// '﻿Código;Nombre\n1;Cemento'
```

- **`bom` (default `true`)**: antepone el BOM UTF-8 (`﻿`). Sin él, Excel
  en Windows (el destino más común de un `.csv` bajado desde el navegador)
  asume la codificación del sistema y rompe acentos y `ñ`; Google
  Sheets/LibreOffice lo ignoran sin problema.
- **`antiInyeccion` (default `true`)**: neutraliza (anteponiendo un
  apóstrofo) una celda de **texto** que arranque con `=`/`+`/`-`/`@` —
  inyección de fórmulas en CSV/Excel (CWE-1236): un dato tipeado por un
  usuario (razón social, detalle, nombre de un proveedor) que empiece así se
  ejecuta como fórmula en la máquina de quien abre el archivo exportado
  (`=HYPERLINK(...)`, exfiltración por red...). Un valor **numérico** nunca
  se toca — un monto negativo (`-5`) no es una fórmula.
- Toda celda con `;`, comillas o salto de línea se envuelve entre comillas
  (RFC 4180).

#### `filasAExcel(nombreHoja, encabezados, filas): Promise<Uint8Array>`

Arma un `.xlsx` de una sola hoja a partir de encabezados + filas ya
formateadas (texto plano, listo para mostrar).

```ts
const buffer = await filasAExcel("Reporte", ["Código", "Nombre"], [["1", "Cemento"]]);
```

### PDF

#### `textoWinAnsi(valor: string): string`

Las fuentes estándar de PDF (`StandardFonts.Helvetica` de `pdf-lib`)
codifican en WinAnsi, y **un solo carácter fuera de eso hace fallar todo el
PDF** (`WinAnsi cannot encode`): un emoji o una letra pegada desde otro
sistema en el nombre de un cliente alcanza. Pasar por acá todo texto que
venga de un usuario antes de `drawText`:

```ts
import { textoWinAnsi } from "@mafesoftware/planillas";

textoWinAnsi("Señal — 10 €"); // "Señal — 10 €" (Latin-1 y puntuación WinAnsi quedan)
textoWinAnsi("Erdős");        // "Erdos" (se le saca el diacrítico)
textoWinAnsi("Fiesta 🎉");     // "Fiesta  " (lo imposible pasa a espacio)
```

