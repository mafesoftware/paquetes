# @mafesoftware/contabilidad

Motor de contabilidad por partida doble para los productos de MAFE Software:
plan de cuentas, asientos balanceados, mapeo de cuentas, libros (diario /
mayor / sumas y saldos / balance / estado de resultados), períodos
contables, refundición de cuentas de resultado al cierre de ejercicio y
ajuste por inflación (RT 6).

**Núcleo puro** (regla 1 de diseño del monorepo): sin base de datos, sin
framework, sin `process.env`. Todo entra por parámetro — plata en `bigint`
(centavos), fechas como `string` `"YYYY-MM-DD"`, factores e índices como
`string` decimal. Armar un `Asiento` a partir de un documento real (factura,
cobro, orden de pago...), resolverlo contra la base, consultar saldos y
persistir todo en una transacción es responsabilidad del consumidor — ese
mapeo documento → asiento es específico de cada producto y no vive acá.

Depende de `@mafesoftware/plata-ar` para el redondeo comercial que usan
`totalPorProyecto`/`calcularProporcionAB` (reparto por mayor resto) y el
ajuste por inflación (`factorEntre`/`aplicarFactor`).

```bash
bun add @mafesoftware/contabilidad
```

## API

### Plan de cuentas (`plan-cuentas.ts`)

#### `validarArbol(cuentas: DefinicionCuenta[]): ResultadoValidarArbol`

Valida la FORMA de un árbol de cuentas: código duplicado, cuenta imputable
con hijas (una imputable es una hoja) y naturaleza heredada (una cuenta hija
no puede declarar una naturaleza distinta de la de su raíz). No valida
`padreCodigo` contra ninguna base — eso es responsabilidad de la capa de
datos del consumidor.

```ts
import { validarArbol } from "@mafesoftware/contabilidad";

validarArbol([
  { codigo: "1", nombre: "Activo", padreCodigo: null, imputable: false, rubroNaturaleza: "activo" },
  { codigo: "1.1", nombre: "Caja", padreCodigo: "1", imputable: true, rubroNaturaleza: "activo" },
]);
// { ok: true }
```

#### `crearPlanDesdePlantilla(nombre, plantilla, plantillas): ResultadoPlanDesdePlantilla`

Arma (sin persistir) la definición de un plan nuevo a partir de una
plantilla ya cargada por el consumidor, validando el árbol antes de
devolverlo.

### Asientos (`asiento.ts`)

#### `balancea(asiento: Asiento): boolean`

Σ debe === Σ haber, en la moneda de informe del asiento — el chequeo central
de toda partida doble.

```ts
import { balancea } from "@mafesoftware/contabilidad";

balancea({
  fecha: "2026-09-15",
  libro: "A",
  tipo: "automatico",
  origen: null,
  leyenda: "Cobro factura #123",
  lineas: [
    { cuentaId: "caja", debe: 100_00n, haber: 0n, moneda: "ARS", importeOriginal: 100_00n, tc: null, proyectoId: null, centroCostoId: null, detalle: "" },
    { cuentaId: "deudores", debe: 0n, haber: 100_00n, moneda: "ARS", importeOriginal: 100_00n, tc: null, proyectoId: null, centroCostoId: null, detalle: "" },
  ],
}); // true
```

#### `espejo(original, fechaAnulacion, origen): Asiento`

Contraasiento de una anulación: misma estructura, debe↔haber invertidos, con
la fecha de anulación — nunca se borra un asiento, se anula con su espejo.

### Mapeos (`mapeos.ts`)

#### `CLAVE` / `resolverCuenta(mapeos, clave, fallback?): string | FaltaMapeo`

`CLAVE` arma cada clave de mapeo parametrizada (`CLAVE.caja(id)`,
`CLAVE.ivaVentas(alicuotaId)`...) para que ningún archivo interpole el
string a mano. `resolverCuenta` busca la cuenta mapeada para esa clave en el
mapa vigente de la organización; sin mapeo (y sin `fallback` mapeado)
devuelve un `FaltaMapeo` en vez de tirar, para que el consumidor acumule
todos los que faltan antes de rechazar el asiento entero.

```ts
import { CLAVE, resolverCuenta } from "@mafesoftware/contabilidad";

resolverCuenta({ "caja:1": "1.1.1.01" }, CLAVE.caja("1")); // "1.1.1.01"
resolverCuenta({}, CLAVE.caja("2"));
// { clave: "caja:2", descripcion: 'Falta asignar una cuenta contable para "caja:2".' }
```

#### `calcularFaltantes(p): ResultadoFaltantes`

Compara las entidades vivas (cajas, tipos de operación, rubros) contra el
mapa de mapeos ya cargado — el motor puro detrás de una pantalla de
"mapeos pendientes": una entidad nueva sin cuenta asignada sale en su lista,
sin que nadie tenga que acordarse de mapearla a mano.

#### `siguienteCodigoSubcuenta(codigosExistentes, prefijo): string`

Próximo código libre bajo un prefijo (`"1.1.1"` + existentes `.01`, `.02` →
`"1.1.1.03"`), para crear una subcuenta nueva sin chocar con una ya creada a
mano.

### Períodos (`periodos.ts`)

#### `periodosMensualesDe(desde): string[]`

Los 12 períodos mensuales (`"YYYY-MM-01"`) de un ejercicio anual a partir de
su fecha de inicio — el consumidor los persiste como `abierto` en su propia
tabla (con su propio tenant).

#### `exigirPeriodoAbierto(estado, fecha): void`

Tira `ErrorPeriodoCerrado` si el período de `fecha` está `"cerrado"` — el
contrato central para cualquier escritura con fecha contable. Sin fila en la
tabla de períodos del consumidor es compatibilidad hacia atrás
(`"abierto"`); esta función no decide eso, solo tira o no según lo que ya se
resolvió.

```ts
import { exigirPeriodoAbierto, ErrorPeriodoCerrado } from "@mafesoftware/contabilidad";

exigirPeriodoAbierto("abierto", "2026-09-15"); // no tira
exigirPeriodoAbierto("cerrado", "2026-08-31"); // tira ErrorPeriodoCerrado("2026-08-01")
```

### Refundición de cierre (`refundicion.ts`)

#### `refundicionDe(saldos, cuentaResultadoId): ResultadoRefundicion`

Arma las líneas que cancelan cada cuenta de resultado (positivo se debita,
negativo se acredita) más la contrapartida a `cuentaResultadoId` por la
diferencia neta del ejercicio — balancea siempre, por construcción.

### Ajuste por inflación RT 6 (`rt6.ts`)

#### `coeficienteRT6(indiceOrigen, indiceCierre): string`

`índice(cierre) / índice(origen)`, redondeado comercial a 8 decimales.

#### `ajustePorRT6(rubros, cuentaReiId): ResultadoRT6`

Reexpresa cada rubro no monetario o de patrimonio neto por su coeficiente
(activo no monetario se debita, PN se acredita) y arma la contrapartida de
REI/RECPAM que hace falta para balancear.

### Reportes (`reportes.ts`)

Convención de signo (RT contable estándar): activo y `resultado_negativo`
(gastos) son de saldo DEUDOR (`debe − haber`); pasivo, PN y
`resultado_positivo` (ingresos) son de saldo ACREEDOR (`haber − debe`).

- `saldoDeCuenta(naturaleza, debe, haber)` — saldo de una cuenta según su
  naturaleza.
- `totalesSumasYSaldos(filas)` — Σ debe / Σ haber de una lista de sumas por
  cuenta (deben coincidir).
- `agruparPorNaturaleza(filas)` / `balanceCuadra(hoja)` — para un balance
  general: agrupa por activo/pasivo/PN/resultado y chequea la igualdad
  contable.
- `evaluarAgrupacion(formula, filas)` — evalúa una fórmula de agrupación
  (p.ej. "Resultado bruto" = 4.1 + 4.2 − 5.1) por prefijo de código.
- `estadoResultadosDeSumas(filas)` — ingresos (código `"4"`) menos egresos
  (código `"5"`), convención habitual del plan de cuentas argentino.
- `saldoCorrido(naturaleza, saldoInicial, movimientos)` — saldo corrido de
  un mayor, movimiento a movimiento.
- `totalPorProyecto(filas)` — reparto por dimensión (proyecto, sucursal,
  centro de costo...).
- `calcularProporcionAB(totalAb, totalB)` — % del libro oficial vs. solo de
  gestión, repartido por mayor resto para que sumen siempre 100.

## Extraído de

`src/lib/dominio/contabilidad/` de Obriq, donde ya era núcleo puro por
diseño (sin `@/db`, `next` ni nada de la app). Quedó afuera `documentos.ts`:
declara el vocabulario de tipos de documento y mapeos propio de Obriq, no
lógica del motor contable en sí.
