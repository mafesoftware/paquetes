# @mafesoftware/retenciones-ar

Retenciones impositivas argentinas para los productos de MAFE Software:
Ganancias (RG 830, mínimo no sujeto acumulado o escala progresiva), IVA
(sobre el IVA del comprobante, no el neto), SUSS construcción (con/sin mano
de obra) e IIBB (padrón ARBA/AGIP o Convenio Multilateral), exclusiones/
certificados de no retención, y el formateo de ancho fijo/delimitado que
usan las exportaciones a los organismos (SICORE, SIRE/F.2004, ARBA, AGIP).

**Núcleo puro** (regla 1 de diseño del monorepo): sin DB, sin framework, sin
`process.env`. Plata en centavos `bigint`; cantidades/alícuotas como
`string` decimal (nunca `number`, para no perder precisión en el redondeo
final). El redondeo pasa SIEMPRE por `redondearComercial` de
`@mafesoftware/plata-ar` — nunca reimplementado acá. Todo entra ya resuelto
por parámetro: tabla de régimen, acumulado del mes, exclusión vigente,
alícuota del padrón. Consultar/persistir eso, y correrlo en una
transacción, es responsabilidad de la app que consume este paquete.

`/drizzle` (peerDependency opcional `drizzle-orm`) trae dos factories de
tabla genéricas (`tablaPadronIibb`, `tablaExclusiones`), parametrizadas por
la columna de tenant — mismo patrón que `@mafesoftware/outbox`/
`@mafesoftware/numeradores`.

```bash
bun add @mafesoftware/retenciones-ar
```

## API

### Cálculo

#### `retencionGanancias(p: ParametrosRetencionGanancias): CalculoRetencion`

Retención de Ganancias (RG 830). Un inscripto tributa sobre el **acumulado**
del mes (neto pagado, incluido este pago) menos el mínimo no sujeto, con
alícuota fija o escala progresiva, restando lo ya retenido en el mes y
aplicando la retención mínima; un no inscripto tributa **sin** mínimo no
sujeto ni retención mínima, sobre el neto de este pago solamente.

```ts
import { retencionGanancias } from "@mafesoftware/retenciones-ar";

const tabla = {
  concepto: "honorarios",
  codigoSicore: "116",
  minimoNoSujeto: 2_200_000n, // $22.000,00
  alicuotaInscripto: "escala" as const,
  alicuotaNoInscripto: "28",
  escala: [
    { desde: 0n, hasta: 10_000_000n, fijo: 0n, porcentaje: "10" },
    { desde: 10_000_000n, hasta: null, fijo: 1_000_000n, porcentaje: "14" },
  ],
  retencionMinima: 9_000n, // $90,00
};

retencionGanancias({
  netoPago: 8_283_000n,
  acumuladoNetoMes: 8_283_000n,
  retenidoMes: 0n,
  inscripto: true,
  tabla,
  exclusion: null,
  fechaPago: "2026-09-15",
});
// { importe: 608_300n, base: 6_083_000n, alicuota: "10", ... }
```

#### `retencionIva(p: ParametrosRetencionIva): CalculoRetencion`

Retención de IVA, calculada sobre el **IVA del comprobante**, no el neto.
`ivaDelPago: 0n` (factura C de un monotributista) devuelve `importe: 0n`
con `explicacion: "monotributista: no corresponde"`. En el último pago de
un documento, la base pasa a ser el `ivaDocumento` completo menos
`retenidoDocumento` — así la suma de las retenciones de todos los pagos da
exacto el porcentaje sobre el IVA total.

```ts
import { retencionIva } from "@mafesoftware/retenciones-ar";

retencionIva({
  ivaDelPago: 1_050_000n,
  alicuotaSobreIva: "80",
  retencionMinima: 9_000n,
  exclusion: null,
  fechaPago: "2026-09-15",
  ultimoPagoDelDocumento: true,
  ivaDocumento: 1_050_000n,
  retenidoDocumento: 0n,
});
// { importe: 840_000n, base: 1_050_000n, ... }
```

#### `retencionSuss(p: ParametrosRetencionSuss): CalculoRetencion`

Retención SUSS construcción: alícuota distinta si el pago incluye mano de
obra o no, sobre el neto del pago — sin acumulado mensual (a diferencia de
Ganancias).

```ts
import { retencionSuss } from "@mafesoftware/retenciones-ar";

retencionSuss({
  netoPago: 10_000_000n,
  conManoDeObra: true,
  alicuotaConMO: "3",
  alicuotaSinMO: "1",
  retencionMinima: 9_000n,
  exclusion: null,
  fechaPago: "2026-09-15",
});
// { importe: 300_000n, alicuota: "3", concepto: "con_mano_de_obra", ... }
```

#### `retencionIibb(p: ParametrosRetencionIibb): CalculoRetencion`

Retención de IIBB: alícuota del padrón de la jurisdicción si el CUIT
figura, si no la alícuota por defecto de la configuración (con una
`explicacion` distinta para notar que falta importar el padrón). Convenio
Multilateral aplica primero el coeficiente de la jurisdicción (`baseCmPct`)
sobre el neto, y recién sobre esa base la alícuota.

```ts
import { retencionIibb } from "@mafesoftware/retenciones-ar";

retencionIibb({
  netoPago: 10_000_000n,
  jurisdiccion: "ARBA",
  alicuotaPadron: "1.75",
  alicuotaNoPadron: "3",
  convenioMultilateral: false,
  baseCmPct: "100",
  exclusion: null,
  fechaPago: "2026-09-15",
});
// { importe: 175_000n, alicuota: "1.75", ... }
```

### Helpers de cálculo (`calculo.ts`)

- **`max0(n: bigint): bigint`** — `n` si es positivo, `0n` si no (el mínimo
  no sujeto nunca deja una base negativa).
- **`aplicarPorcentaje(base: bigint, porcentaje: string): bigint`** —
  `base * porcentaje / 100`, exacto en `bigint` (fracción, sin redondear
  pasos intermedios), redondeado una sola vez al final con
  `redondearComercial`.
- **`aplicarExclusion(importe: bigint, exclusion: Exclusion | null): bigint`**
  — reduce `importe` por el porcentaje de la exclusión (`100` = exclusión
  total); `null` no cambia nada.
- **`formatearPesos(centavos: bigint): string`** — `8283000n` →
  `"82.830,00"` (es-AR), solo para `explicacion`.
- **`netoDelPago(documento: { neto: bigint; total: bigint }, pagado: bigint): bigint`**
  — proporción del neto de un documento que corresponde a `pagado` centavos
  acumulados; llamando con el acumulado en cada pago y restando el
  resultado del pago anterior, el último pago absorbe el resto de redondeo
  y la suma da exacto el neto del documento.

### Exclusiones

#### `exclusionVigente(exclusiones: Exclusion[], regimen: Regimen, fecha: string): Exclusion | null`

La primera exclusión/certificado de no retención vigente a `fecha`
(inclusive en ambos extremos) para ese régimen, o `null`.

```ts
import { exclusionVigente } from "@mafesoftware/retenciones-ar";

exclusionVigente(
  [{ regimen: "ganancias", porcentaje: "100", desde: "2026-01-01", hasta: "2026-12-31", certificado: "123" }],
  "ganancias",
  "2026-09-15",
); // la exclusión de arriba
```

### Jurisdicción y padrón de IIBB

#### `jurisdiccionDeProvincia(provincia: string | null): Jurisdiccion | null`

Mapea una provincia en texto libre a la jurisdicción de padrón soportada
(`"ARBA" | "AGIP"`); cualquier otra provincia (o sin padrón soportado
todavía) devuelve `null`.

```ts
import { jurisdiccionDeProvincia } from "@mafesoftware/retenciones-ar";

jurisdiccionDeProvincia("Ciudad Autónoma de Buenos Aires"); // "AGIP"
jurisdiccionDeProvincia("Buenos Aires"); // "ARBA"
jurisdiccionDeProvincia("Córdoba"); // null
```

#### `parsearLineaArba(linea: string): ResultadoParseoArba` / `parsearLineaAgip(linea: string): ResultadoParseoAgip`

Parsean una línea del archivo de padrón que publica cada organismo
(separado por `|`, fechas `ddmmaaaa`, alícuota con coma). Nunca tiran: una
línea malformada vuelve `{ ok: false, error }`, y quien orquesta la
importación del archivo completo decide si sigue con el resto. Una línea
ARBA produce una fila; una línea AGIP puede producir hasta dos (percepción
y retención).

#### `elegirAlicuotaVigente(filas: FilaPadronConOrigen[], fecha: string): string | null`

Elige la alícuota vigente a `fecha` entre candidatas ya filtradas por
CUIT+tipo. Un override de la organización (`origen: "organizacion"`) gana
siempre sobre el global; entre varias globales vigentes, gana la de
vigencia más reciente.

### Serialización

#### `serializarTablaGanancias(tabla: TablaGanancias): TablaGananciasSerializada` / `deserializarTablaGanancias(tabla: TablaGananciasSerializada): TablaGanancias`

Frontera `bigint` ↔ `string` para persistir una `TablaGanancias` (config de
régimen/concepto, global o con override por organización) en una columna
`jsonb` — `JSON.stringify` no sabe serializar un `bigint`.

### Formato (SICORE/SIRE/ARBA/AGIP)

Building blocks de formateo compartidos por los exportadores fiscales; el
layout campo a campo de cada archivo es de cada app.

- **`anchoFijo(valor, ancho, { relleno?, alinear? })`** /
  **`numeroFijo(valor, ancho)`** — ancho fijo genérico / numérico con ceros
  a la izquierda (SICORE/SIRE).
- **`soloDigitos(valor)`** / **`cuitSinGuiones(cuit)`** /
  **`cuitConGuiones(cuit)`** — `"20304050607"` ↔ `"20-30405060-7"`.
- **`fechaCompacta(fecha)`** — `"2026-09-15"` → `"20260915"` (SICORE/SIRE).
- **`fechaBarras(fecha)`** — `"2026-09-15"` → `"15/09/2026"` (ARBA/AGIP).
- **`importeSinComaAncho(centavos, ancho)`** / **`importeConComa(centavos)`**
  — importe sin coma a ancho fijo / con coma decimal; tiran ante un negativo
  (un importe fiscal exportado nunca es negativo).
- **`porcentajeConComa(porcentaje)`** / **`alicuotaCorta(porcentaje)`** —
  alícuota formateada con coma, dos anchos distintos según el organismo.
- **`armarContenido(lineas)`** — une líneas con CRLF + CRLF final.
- **`filaDelimitada(celdas)`** — fila `;` (ARBA/AGIP).
- **`aBufferLatin1(contenido)`** — codifica a ISO-8859-1, el charset que
  declaran los cuatro organismos para sus archivos de importación.

### `/drizzle`

#### `tablaPadronIibb(opciones?: OpcionesTablaPadronIibb): TablaPadronIibb`

Tabla para guardar el padrón de IIBB (ARBA/AGIP) importado, por tenant: una
fila por `(jurisdicción, período, CUIT, tipo)`, pensada para un "swap" por
período dentro de una transacción.

```ts
import { tablaPadronIibb } from "@mafesoftware/retenciones-ar/drizzle";

export const padronIibb = tablaPadronIibb();
```

#### `tablaExclusiones(opciones?: OpcionesTablaExclusiones): TablaExclusiones`

Tabla para guardar certificados de exclusión/no retención de un proveedor
(o cualquier sujeto retenido), por tenant. Sin FK al sujeto retenido a
propósito — se agrega vía `columnasExtra`.

```ts
import { uuid } from "drizzle-orm/pg-core";
import { tablaExclusiones } from "@mafesoftware/retenciones-ar/drizzle";

export const exclusiones = tablaExclusiones({
  columnasExtra: { proveedorId: uuid("proveedor_id").notNull() },
});
```

## Lo que este paquete NO resuelve

Queda del lado de cada app, porque depende de decisiones propias del
dominio: el catálogo de regímenes/alícuotas en sí (global de plataforma vs.
override por organización), el acumulado mensual de Ganancias con bloqueo
`FOR UPDATE`, la numeración de certificados de retención emitidos al pagar,
las FKs a proveedores/razones sociales/órdenes de pago, y el layout exacto
campo a campo de cada archivo SICORE/SIRE/ARBA/AGIP.

Extraído de Obriq (`src/lib/dominio/retenciones/`), donde ya era núcleo
puro por diseño (sin `@/db`, `next` ni nada de la app).
