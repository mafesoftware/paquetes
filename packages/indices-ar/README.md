# @mafesoftware/indices-ar

Índices de ajuste argentinos (CAC, ICC, UVA, CER, IPC, ICL): factores de
ajuste, período de referencia, las tres modalidades de ajuste
(disponible/provisorio/definitivo), topes, fórmulas polinómicas y saldo en
puntos-índice (spec 02 §3). Núcleo puro: sin DB, sin framework, sin
`process.env` — todo lo que sale a la red (`/fuentes`) acepta un `fetch`
inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/indices-ar
```

Depende de `@mafesoftware/plata-ar` (≥0.2, `factorEntre`/`aplicarFactor`
para la aritmética de factores en `bigint`, nunca reimplementada acá) y de
`@mafesoftware/fechas-ar` (≥0.2, `Periodo`/`sumarPeriodos` para el desfase
de período).

## Probar

```bash
bun test
```

## API

### `calcularAjuste(montoBase, valorBase, valorRef)`

El ajuste de una cuota por índice (spec 02 §3.2): `factor = valorRef /
valorBase` (8 decimales), `montoAjustado = redondear(montoBase × factor)`,
`ajuste = montoAjustado − montoBase`.

```ts
import { calcularAjuste } from "@mafesoftware/indices-ar";

calcularAjuste(10_000_000n, "3448.3", "3662.2");
// { factor: "1.06203057", montoAjustado: 10_620_306n, ajuste: 620_306n }

calcularAjuste(10_000_000n, "100", "90"); // ajuste NEGATIVO (deflación)
// { factor: "0.9", montoAjustado: 9_000_000n, ajuste: -1_000_000n }
```

### `periodoReferencia(vencimiento, regla, ultimoPublicado)`

El período de índice que corresponde usar para una cuota que vence el
`vencimiento` dado, según la regla del contrato: `{ tipo: "desfase"; meses
}` (vencimiento menos `meses`) o `{ tipo: "ultimo_publicado" }` (el último
publicado, que quien llama calcula y pasa en `ultimoPublicado`).

```ts
import { periodoReferencia } from "@mafesoftware/indices-ar";

periodoReferencia("2026-09-10", { tipo: "desfase", meses: 2 }, null); // "2026-07"
periodoReferencia("2026-09-10", { tipo: "ultimo_publicado" }, null); // null: nada publicado todavía
periodoReferencia("2026-09-10", { tipo: "ultimo_publicado" }, "2026-08"); // "2026-08"
```

### `diferenciaDeAjuste(montoBase, valorBase, valorUsado, valorDefinitivo)`

La diferencia entre el monto ajustado con el valor DEFINITIVO (publicado
después) y con el valor USADO al liquidar (modalidades
provisorio/definitivo, spec 02 §3.2).

```ts
import { diferenciaDeAjuste } from "@mafesoftware/indices-ar";

diferenciaDeAjuste(10_000_000n, "3448.3", "3650.0", "3662.2"); // 35_380n (hay que cobrar de más)
```

### `ModalidadAjuste` / `accionAlPublicarDefinitivo(modalidad, cuotaCobrada)`

Qué corresponde hacer cuando se publica el valor definitivo de un período
(spec 02 §3.2): una cuota **no cobrada** siempre se recalcula; una cobrada
depende de la modalidad con la que se liquidó (`"disponible"` → queda
firme; `"provisorio"` → diferencia a la próxima cuota; `"definitivo"` →
documento de ajuste aparte).

```ts
import { accionAlPublicarDefinitivo, type ModalidadAjuste } from "@mafesoftware/indices-ar";

accionAlPublicarDefinitivo("definitivo", false); // "recalcular": no cobrada, sin importar la modalidad
accionAlPublicarDefinitivo("disponible", true); // "nada"
accionAlPublicarDefinitivo("provisorio", true); // "diferencia_proxima_cuota"
accionAlPublicarDefinitivo("definitivo", true); // "documento_ajuste"
```

### `aplicarTope({ ajusteAcumuladoPct, topePct, ajusteNuevo, montoBase })` / `soloPositivo(ajuste)`

El tope opcional de un contrato (spec 02 §3.2): cuánto de `ajusteNuevo` cabe
antes de que el acumulado supere `topePct` de `montoBase`; el resto queda
"absorbido por la desarrolladora". Solo limita ajustes hacia ARRIBA — uno
negativo (deflación) pasa entero.

```ts
import { aplicarTope, soloPositivo } from "@mafesoftware/indices-ar";

aplicarTope({ ajusteAcumuladoPct: "12", topePct: "15", ajusteNuevo: 5_000_000n, montoBase: 100_000_000n });
// { ajusteAplicado: 3_000_000n, excedenteAbsorbido: 2_000_000n }

soloPositivo(-50_000n); // 0n
soloPositivo(50_000n); // 50_000n
```

### `valorPolinomica(componentes)`

`Σ peso_i × (índice_i actual / índice_i base)` (spec 02 §3.1): la fórmula de
un índice propio armado con componentes de otros índices (ej. `0.45` mano
de obra + `0.45` materiales + `0.10` gastos generales). Los pesos tienen
que sumar 1 (±1e-8) — si no, tira `ErrorIndices`. Devuelve un string de 8
decimales, exacto en `bigint` de punta a punta.

```ts
import { valorPolinomica } from "@mafesoftware/indices-ar";

valorPolinomica([
  { peso: "0.45", actual: "150", base: "100" },
  { peso: "0.45", actual: "120", base: "100" },
  { peso: "0.10", actual: "110", base: "100" },
]); // "1.325"
```

### `puntosIndice(saldo, valorBase)` / `saldoDesdePuntos(puntos, valorActual)`

El saldo de un boleto en "unidades índice" (spec 02 §3.2) y su inverso:
cuánto vale hoy un saldo congelado en puntos, al valor actual del índice.

```ts
import { puntosIndice, saldoDesdePuntos } from "@mafesoftware/indices-ar";

puntosIndice(3_448_300n, "3448.3"); // "1000" (exacto)
saldoDesdePuntos("1000", "3448.3"); // 3_448_300n
```

### `ErrorIndices` / `CodigoErrorIndices`

```ts
import { ErrorIndices, type CodigoErrorIndices } from "@mafesoftware/indices-ar";

try {
  // ...
} catch (e) {
  if (e instanceof ErrorIndices) {
    e.codigo; // "regla_invalida" | "indice_invalido" | "valor_invalido"
              // | "peso_invalido" | "polinomica_vacia" | "pesos_no_suman_uno"
  }
}
```

Errores de `@mafesoftware/plata-ar` (`ErrorPlata`, `indice_invalido`) y de
`@mafesoftware/fechas-ar` (`ErrorFecha`) se propagan tal cual cuando la
validación es de esos paquetes (un `valorBase`/`valorRef` inválido, un
`vencimiento` con formato roto) — este paquete no los reenvuelve.

## `/drizzle`

Requiere `drizzle-orm >=0.45 <0.46` (peerDependency opcional). No trae
migraciones (spec 06 §3.2) — ver `sql/ejemplo.sql` para el DDL de
referencia.

```ts
import { tablaIndices, tablaValoresIndice, tablaCotizaciones, valorVigente } from "@mafesoftware/indices-ar/drizzle";

export const indices = tablaIndices();
export const valoresIndice = tablaValoresIndice();
export const cotizaciones = tablaCotizaciones();

const v = await valorVigente(db, valoresIndice, { tenantId, indice: "UVA", periodo: "2026-09" });
// v?.tenantId === tenantId si esa organización cargó un override para
// "2026-09"; si no, v?.tenantId === null (el valor global de la
// plataforma), o v === null si no hay NINGUNO de los dos todavía.
```

- **`tablaIndices({ nombre?, columnasExtra? })`**: el catálogo global de
  índices soportados — `codigo` (PK), `nombre`, `fuente`, `frecuencia`.
- **`tablaValoresIndice({ tenant?, nombre?, columnasExtra? })`**: el valor
  mensual de cada índice — `tenantId` (**nullable**: `NULL` es el valor
  GLOBAL de la plataforma, un id concreto es el override de esa
  organización), `indice`, `periodo`, `valor` (`numeric(20,8)` como
  string), `estado` (`"provisorio" | "definitivo"`), `fechaPublicacion`,
  `fuente`. Dos índices únicos PARCIALES —`(tenant, indice, periodo)
  WHERE tenant IS NOT NULL` y `(indice, periodo) WHERE tenant IS NULL`—
  en vez de uno solo, porque Postgres no trata dos `NULL` como iguales
  (ver el JSDoc de `tablaValoresIndice` para el detalle).
- **`tablaCotizaciones({ tenant?, nombre?, columnasExtra? })`**: cotizaciones
  diarias — `tenantId` (misma convención nullable), `fecha`, `fuente`,
  `compra`/`venta` (`numeric(20,6)` como string). Mismos dos índices
  únicos parciales, sobre `(fecha, fuente)`.
- **`valorVigente(db, tablaValoresIndice, { tenantId?, indice, periodo })`**:
  el override de `tenantId` si existe, si no el valor global. Sin
  `tenantId`, busca directo el global. No exige transacción (es una
  lectura).

## `/fuentes`

Lectores de fuentes públicas con `fetch` **inyectado** (nunca
`globalThis.fetch` leído directo). Ninguna de las dos tira: devuelven
`{ ok: true; valores } | { ok: false; categoria: "red" | "http" | "formato" }`.

```ts
import { leerUvaCer, leerCotizaciones } from "@mafesoftware/indices-ar/fuentes";

const r1 = await leerUvaCer({ fetch, desde: "2026-09-01", hasta: "2026-09-10" });
// r1.valores: [{ indice: "UVA", fecha: "2026-09-01", valor: "2100.49" }, ..., { indice: "CER", ... }, ...]

const r2 = await leerCotizaciones({ fetch });
// r2.valores: [{ casa: "oficial", compra: "1500", venta: "1550", fecha: "..." }, ...]
```

- **`leerUvaCer({ fetch, desde?, hasta? })`**: lee UVA (id de variable 31) y
  CER (id 30) de la API pública de Estadísticas Monetarias del BCRA
  (`api.bcra.gob.ar/estadisticas/v4.0/monetarias/{id}`).
- **`leerCotizaciones({ fetch })`**: lee dolarapi.com (`/v1/dolares`),
  filtrado a las cuatro casas que usa el producto: `oficial`, `blue`, `mep`
  (`"bolsa"` en dolarapi) y `ccl` (`"contadoconliqui"`).
