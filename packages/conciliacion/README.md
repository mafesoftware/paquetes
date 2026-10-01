# @mafesoftware/conciliacion

Conciliación bancaria argentina, en dos piezas independientes:

- **Parseo de extractos** (`parsearExtracto`/`detectarBanco`): CSV/XLSX/PDF
  de 6 bancos (Galicia, Santander, BBVA, Macro, Nación, Provincia) a líneas
  normalizadas (`fecha` ISO, `importe`/`saldo` en **centavos `bigint` con
  signo**), más `parsearConMapeo` genérico por si hace falta un mapeo manual
  (banco no soportado acá, o archivo con columnas reordenadas).
- **Motor de sugerencia de matches** (`sugerirMatches`): cruza esas líneas
  contra los movimientos conciliables del sistema que integra el paquete
  (cobros, órdenes de pago, transferencias) y propone matches por
  `referencia_cuit` / `importe_fecha` / `combinacion`, en orden de certeza
  decreciente.

Extraído de Obriq (`src/lib/dominio/conciliacion/` + `src/lib/extractos/`),
donde ya era **núcleo puro** por diseño: sin `@/db`, sin `next`, sin ninguna
dependencia de la app. El parseo de archivo (`.xlsx`/`.pdf`, con
`exceljs`/`pdfjs-dist`) queda aislado en sus propios módulos (`xlsx.ts`,
`pdf.ts`) — el matching (`sugerir.ts`/`combinaciones.ts`/`clasificar.ts`) no
hace I/O de ningún tipo.

```bash
bun add @mafesoftware/conciliacion
```

Ningún parser de banco tira por una línea mala de forma silenciosa: una
inconsistencia de saldo corrido queda en `advertencias` (no interrumpe el
parseo). `parsearExtracto` **sí tira** (es una utilidad de dominio pura, no
devuelve `Resultado` — quien la llama desde una Server Action la traduce a
`{ok:false, error}`) con mensajes en español listos para mostrar: banco no
soportado, formato no soportado para ese banco, PDF protegido o con
contraseña incorrecta.

## API

### Parseo de extractos

#### `parsearExtracto(nombreBanco, archivo, opciones): Promise<ExtractoCuenta[]>`

Punto de entrada: parsea el extracto de `nombreBanco` en el formato pedido.

```ts
type OpcionesParsearExtracto = {
  formato: "csv" | "xlsx" | "pdf";
  contrasena?: string; // PDF protegido por contraseña
  mapeo?: MapeoColumnas; // override manual, ver más abajo
};

const extractos = await parsearExtracto("galicia", archivoBytes, { formato: "csv" });
```

```ts
type ExtractoCuenta = {
  cuenta: string;
  moneda: Moneda; // de @mafesoftware/plata-ar
  lineas: LineaExtractoSinId[]; // { fecha, descripcion, importe, saldo, referencia }
  advertencias?: { linea: number; mensaje: string }[];
};
```

Devuelve un **array** porque un mismo archivo puede traer más de una cuenta
(el PDF multicuenta de Galicia trae ARS y USD en el mismo extracto → 2
`ExtractoCuenta`, uno por moneda).

`importe`/`saldo` son `bigint` en **centavos, con signo** — nunca `number`.
`fecha` siempre `YYYY-MM-DD` (ISO), sea cual sea el formato que use el banco
en el archivo original.

#### `detectarBanco(archivo, nombreArchivo): string | null`

Adivina el banco por nombre de archivo y/o contenido (encabezado del CSV,
layout del XLSX). `null` = no reconocido — mostrale al usuario un selector
manual con `bancosSoportados()`.

#### `bancosSoportados(): string[]` / `bancosConFormato(formato): string[]`

Nombres de banco soportados, en general o filtrado por formato (para armar
un mensaje de "este banco no tiene PDF soportado, ¿tenés el CSV?").

### Bancos soportados

| Banco | Formatos | Notas |
|---|---|---|
| `galicia` | `csv`, `pdf` | El PDF puede traer varias cuentas/monedas en el mismo archivo. |
| `santander` | `csv` | Importe con signo en una sola columna. |
| `bbva` | `xlsx` | La tabla real empieza después de un título/logo; se recorta desde la fila de encabezado. |
| `macro` | `csv` | Columnas desordenadas respecto del resto. |
| `nacion` | `csv` | Separador decimal `.` (el resto usa `,`). |
| `provincia` | `csv` | — |

### Mapeo manual (banco no soportado, o columnas reordenadas)

#### `parsearConMapeo(filas, mapeo): ResultadoMapeo`

Motor genérico: convierte filas tabulares (`string[][]`, de un CSV o un
XLSX ya leídos) en líneas de extracto usando un `MapeoColumnas` que
referencia columnas por **nombre**, no por posición.

```ts
type MapeoColumnas = {
  fecha: string;
  descripcion: string;
  importe?: string; // una sola columna con signo...
  debito?: string; // ...o débito/crédito en columnas separadas (ambas positivas)
  credito?: string;
  saldo?: string;
  referencia?: string;
  formatoFecha: string; // ej. "DD/MM/YYYY" — se matchea por token, no por separador exacto
  separadorDecimal: "," | ".";
};
```

Una inconsistencia entre `saldo` corrido y `saldo anterior + importe` queda
en `advertencias` con el número de línea del archivo real — no aborta el
parseo.

#### Utilidades de más bajo nivel

`parsearFilasCsv(texto, separador?)` — CSV con comillas (RFC 4180) a
`string[][]`. `parsearImporteAr(valor, separadorDecimal)` — importe en
formato argentino (paréntesis = negativo, símbolo de moneda tolerado) a
centavos `bigint`; deliberadamente más permisivo que
`@mafesoftware/plata-ar#parsearImporte` (pensado para texto tipeado por una
persona): un extracto es un formato fijo que ya declara su propio
`separadorDecimal`. `parsearFechaConFormato(valor, formato)` — fecha en el
formato que declare el banco a ISO. `leerFilasXlsx(archivo)` — primera hoja
de un `.xlsx` a `string[][]` (I/O, `exceljs`). `extraerLineasPdf(archivo,
opciones?)` — texto de un `.pdf` por página (I/O, `pdfjs-dist`, import
dinámico).

### Motor de sugerencia de matches

#### `sugerirMatches(lineas, movs, opciones): Sugerencia[]`

Cruza las líneas de un extracto ya parseado contra los movimientos
conciliables del sistema que integra este paquete, por tres reglas en
orden de certeza decreciente — ninguna línea ni movimiento se sugiere dos
veces:

1. **`referencia_cuit`** — mismo importe y el CUIT de la contraparte del
   movimiento aparece en la descripción de la línea (desambigua importes
   repetidos que `importe_fecha` dejaría ambiguos). La extracción de CUIT
   es una comparación de dígitos simple, **sin** validar dígito
   verificador: la descripción de un extracto es texto libre de un banco,
   no un formulario — exigir que matchee
   `@mafesoftware/documentos-ar#validarCuit` rechazaría de más.
2. **`importe_fecha`** — mismo importe exacto y único candidato dentro de
   `toleranciaDias`; más de un candidato = ambiguo, sin sugerencia por esta
   regla (puede resolverse por CUIT o quedar sin matchear).
3. **`combinacion`** — una línea sin match directo cuya suma con 2..
   `maxCombinacion` movimientos del mismo signo, dentro de la ventana de
   fecha, coincide exacto.

```ts
type OpcionesSugerir = { toleranciaDias: number; maxCombinacion: number };

type Sugerencia = {
  lineaIds: string[];
  movimientoIds: string[];
  regla: "importe_fecha" | "referencia_cuit" | "combinacion";
  confianza: number; // 0..1
  diferenciaDias: number;
};

const sugerencias = sugerirMatches(lineasDelExtracto, movimientosConciliables, {
  toleranciaDias: 3,
  maxCombinacion: 4,
});
```

Los tipos `LineaExtracto`/`MovConciliable` de `sugerirMatches` son locales
a este módulo (misma forma que los de `motor.ts`, pero deliberadamente sin
importarlos de ahí): el matching funciona con líneas/movimientos que vengan
de cualquier lado, no solo de un archivo recién parseado acá.

#### `buscarCombinacion(objetivo, candidatos, maxCombinacion): string[] | null`

La búsqueda de combinaciones detrás de la regla 3: DFS con poda (acotada a
los primeros 15 candidatos recibidos — se espera que el llamador los haya
ordenado por cercanía de fecha), no un subset-sum general.

#### `clasificarSoloExtracto(descripcion, reglas?): string | null`

Clasifica una línea que **no** tiene contraparte en el sistema (impuesto,
comisión, interés bancario) por patrón de texto sobre la descripción.
`REGLAS_CLASIFICACION_DEFECTO` cubre los casos típicos de un extracto
argentino (Ley 25.413, comisión/mantenimiento, intereses, IVA sobre gastos
bancarios, sellos); el llamador puede pasar las suyas (config por
organización/banco).

## Dependencias

`@mafesoftware/fechas-ar` (cálculo de distancia entre fechas, calendario
puro) y `@mafesoftware/plata-ar` (tipo `Moneda`) son dependencias normales.
`exceljs`/`pdfjs-dist` también — este paquete hace I/O de archivo
(`.xlsx`/`.pdf`) pero no habla con ningún servicio externo, así que no
hacía falta inyectarlas como en `archivos-s3` (que sí inyecta el
`S3Client`, un cliente de red).
