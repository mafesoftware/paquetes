# @mafesoftware/proveedores

Dominio de proveedores para un ERP/SaaS multi-tenant argentino: totales de un
documento de proveedor (ítems, IVA, percepciones, validación con tolerancia
de redondeo), prorrateo por porcentaje entre proyectos, la decisión de
archivar un proveedor con saldo pendiente, y el balance/aprobación de una
orden de pago.

**Núcleo puro**: sin DB, sin framework, sin variables de entorno — cada
función entra con datos y sale con un resultado. Depende de
`@mafesoftware/plata-ar` (redondeo comercial en `bigint`, reparto por mayor
resto, el tipo `Moneda`): la aritmética de plata no se reimplementa acá.

```bash
bun add @mafesoftware/proveedores
```

Ningún error de negocio se tira: las funciones que pueden fallar devuelven
un resultado (`{ ok: true, ... } | { ok: false, ... }`).

## API

### IVA (`iva.ts`)

```ts
type AlicuotaIva = "21" | "10_5" | "27" | "0" | "exento" | "no_gravado";
const ALICUOTAS_IVA: readonly AlicuotaIva[];

function calcularIva(subtotalCentavos: bigint, alicuota: AlicuotaIva): bigint;
function esAlicuotaIva(x: unknown): x is AlicuotaIva;
```

`10_5` es `105/1000` como fracción exacta (nunca `10.5/100` en `number`): el
guion bajo evita el punto decimal que un enum de base de datos no siempre
admite.

```ts
calcularIva(100_000n, "21");   // 21_000n ($210,00 de IVA sobre $1000)
calcularIva(100_000n, "10_5"); // 10_500n
calcularIva(100_000n, "exento"); // 0n
```

### Totales (`totales.ts`)

```ts
type ItemParaTotal = { cantidad: string; precioUnitarioCentavos: bigint; alicuotaIva: AlicuotaIva };
type PercepcionParaTotal = { tipo: "iva" | "iibb" | "otras"; centavos: string };
type TotalesDocumento = { subtotal: bigint; iva: bigint };
type ResultadoValidacionTotal = { ok: true; ajuste: bigint } | { ok: false; diferencia: bigint };

function subtotalItem(cantidad: string, precioUnitarioCentavos: bigint): bigint;
function totalesDeItems(items: readonly ItemParaTotal[]): TotalesDocumento;
function totalPercepciones(percepciones: readonly PercepcionParaTotal[]): bigint;
function validarTotalDocumento(calculado: bigint, informado: bigint): ResultadoValidacionTotal;
```

Total = Σ ítems + IVA + percepciones. `validarTotalDocumento` compara el
total calculado contra el informado en el documento: tolera una diferencia
de hasta $1 (100 centavos) y devuelve el `ajuste` a persistir
EXPLÍCITAMENTE — nunca lo aplica en silencio, y nunca tolera una diferencia
mayor (`{ ok: false, diferencia }`).

`cantidad` acepta hasta 4 decimales (`"2.5"`, `"0.25"`); `PercepcionParaTotal.centavos`
viene en STRING a propósito, para encajar tal cual con una fila leída de
JSON o de una columna de base de datos donde un `bigint` no es representable
nativamente.

### Prorrateo (`prorrateo.ts`)

```ts
function sumaCien(porcentajes: readonly string[]): boolean;
function prorratearPorPorcentaje(totalCentavos: bigint, porcentajes: readonly string[]): bigint[];
```

Prorratea un documento "general" entre proyectos: los pesos son porcentajes
que tienen que sumar 100 (`sumaCien`, con tolerancia de centésimas). El
reparto en sí es por mayor resto (delega en `repartirPorMayorResto` de
`@mafesoftware/plata-ar`): la suma de las partes da siempre el total exacto,
sin perder ni inventar un centavo.

```ts
prorratearPorPorcentaje(10_000n, ["33", "33", "34"]); // Σ === 10_000n
```

### Archivar un proveedor (`archivar.ts`)

```ts
type DecisionArchivarProveedor = { ok: true } | { ok: false; error: string; requiereConfirmacion: true };

function decidirArchivarProveedor(opts: { tieneSaldoPendiente: boolean; confirmado: boolean }): DecisionArchivarProveedor;
```

Archivar sin saldo pendiente siempre procede. Con saldo pendiente, hace
falta `confirmado: true` — nunca bloquea para siempre, solo exige que quien
archiva lo haga a sabiendas.

### Orden de pago: balance (`balance-orden-pago.ts`)

```ts
type MontoConMoneda = { monto: bigint; moneda: Moneda }; // Moneda de @mafesoftware/plata-ar
type ImputacionParaBalance = MontoConMoneda & { consumeAnticipo: boolean };
type ResultadoBalanceOp = { ok: true } | { ok: false; error: string; moneda: Moneda; diferencia: bigint };

function totalPorMoneda(items: readonly MontoConMoneda[]): Partial<Record<Moneda, bigint>>;
function validarBalanceOp(medios: readonly MontoConMoneda[], imputaciones: readonly ImputacionParaBalance[]): ResultadoBalanceOp;
function excedeSaldoDocumento(montoAImputar: bigint, saldoPendiente: bigint): boolean;
function saldoDisponibleAnticipo(monto: bigint, montoAplicado: bigint): bigint;
```

`validarBalanceOp` exige que los medios de pago cubran EXACTAMENTE lo que
hace falta pagar con plata nueva, moneda por moneda (multi-caja
multi-moneda, nunca se suman ARS con USD). Una imputación que consume un
anticipo ya existente no exige plata nueva en medios de pago.

### Orden de pago: aprobación (`aprobacion-orden-pago.ts`)

```ts
type EstadoOrdenPago = "borrador" | "pendiente_aprobacion" | "aprobada" | "pagada" | "anulada";

function requiereAprobacion(totalCentavos: bigint, umbralCentavos: bigint | null): boolean;
function estadoInicialOp(hacenFaltaAprobacion: boolean, quienCreaPuedeAprobar: boolean): EstadoOrdenPago;
```

`umbralCentavos: null` = sin umbral configurado, nunca hace falta aprobación.
Estrictamente POR ENCIMA del umbral (igual al umbral no exige). Sin
aprobación requerida, la OP queda `"aprobada"` directo; con aprobación
requerida, queda `"aprobada"` si quien la crea ya tiene el permiso para
aprobar, o `"pendiente_aprobacion"` si no.
