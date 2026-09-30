# @mafesoftware/tesoreria

Decisiones de negocio de tesorería para los productos de MAFE Software:
saldos de caja, transferencias entre cajas (con tipo de cambio implícito
cuando cambian de moneda), arqueo y el ciclo de una rendición de gastos.

**Núcleo puro** (regla 1 de diseño del monorepo): sin base de datos, sin
framework, sin `process.env`. Todo entra por parámetro — saldos, fechas y
estados en `bigint`/`string`, nunca leídos de un ORM ni de un reloj propio.
Consultar el saldo real, escribir el movimiento y correr todo en una
transacción es responsabilidad de la app que consume este paquete; acá solo
vive la decisión pura sobre esos datos.

Depende de `@mafesoftware/plata-ar` para el redondeo comercial (medio hacia
arriba) que usa `tcImplicito`.

```bash
bun add @mafesoftware/tesoreria
```

## API

### `decidirEgreso(saldoActual: bigint, importeCentavos: bigint, permiteNegativo: boolean): DecisionEgreso`

¿Se puede registrar un egreso de `importeCentavos` sobre una caja con
`saldoActual`? Si la caja no puede quedar negativa (`permiteNegativo:
false`) y el egreso supera el saldo, devuelve un error claro con el saldo
disponible en vez de tirar. Una caja con `permiteNegativo: true` siempre
puede.

```ts
import { decidirEgreso } from "@mafesoftware/tesoreria";

decidirEgreso(10_000n, 15_000n, false);
// { ok: false, error: "Saldo insuficiente en la caja para este egreso.", saldoDisponible: 10_000n }

decidirEgreso(10_000n, 10_000n, false); // { ok: true } (queda en cero, no negativo)
decidirEgreso(10_000n, 50_000n, true); // { ok: true } (la caja permite quedar negativa)
```

### `fechaBloqueadaPorCierre(fechaMovimiento: string, fechaUltimoCierre: string | null): boolean`

¿Esta fecha de movimiento (`"YYYY-MM-DD"`) está bloqueada por el último
cierre VIGENTE de la caja? Un cierre bloquea su propia fecha y cualquier
fecha anterior — para cargar un movimiento ahí primero hay que reabrir el
cierre. `fechaUltimoCierre: null` (la caja nunca se cerró) nunca bloquea.

```ts
import { fechaBloqueadaPorCierre } from "@mafesoftware/tesoreria";

fechaBloqueadaPorCierre("2026-08-31", "2026-09-15"); // true (anterior al cierre)
fechaBloqueadaPorCierre("2026-09-15", "2026-09-15"); // true (el cierre incluye ese día)
fechaBloqueadaPorCierre("2026-09-16", "2026-09-15"); // false (posterior al cierre)
fechaBloqueadaPorCierre("2020-01-01", null); // false (la caja nunca se cerró)
```

### `tcImplicito(importeOrigenCentavos: bigint, importeDestinoCentavos: bigint): string`

El tipo de cambio implícito de una transferencia con cambio de moneda:
`importeOrigen / importeDestino`, como decimal de 6 dígitos, redondeado
medio hacia arriba al sexto decimal (`redondearComercial` de
`@mafesoftware/plata-ar`). Tira si `importeDestinoCentavos` no es mayor a 0
(no hay TC posible sin un destino positivo).

```ts
import { tcImplicito } from "@mafesoftware/tesoreria";

// 1.535.000,00 origen (153.500.000 centavos) / 1.000,00 destino (100.000 centavos)
tcImplicito(153_500_000n, 100_000n); // "1535.000000"
```

### `CATEGORIA_TRANSFERENCIA` / `esTransferenciaInterna(categoriaCashflow: string): boolean`

La categoría de cashflow que llevan los movimientos que genera una
transferencia entre cajas propias, y el chequeo de si una categoría es esa:
una transferencia interna no es un ingreso ni un egreso real, así que queda
afuera de cualquier cashflow operativo que se arme a partir de las
categorías de los movimientos.

```ts
import { CATEGORIA_TRANSFERENCIA, esTransferenciaInterna } from "@mafesoftware/tesoreria";

CATEGORIA_TRANSFERENCIA; // "transferencia_interna"
esTransferenciaInterna("transferencia_interna"); // true
esTransferenciaInterna("cobro_cuota"); // false
```

### `diferenciaArqueo(saldoSistema: bigint, saldoContado: bigint): bigint`

La diferencia de un arqueo: `saldoContado - saldoSistema` (positivo =
sobra, negativo = falta).

```ts
import { diferenciaArqueo } from "@mafesoftware/tesoreria";

diferenciaArqueo(10_000n, 10_500n); // 500n (sobran 5 pesos)
diferenciaArqueo(10_000n, 9_800n); // -200n (faltan 2 pesos)
```

### `requiereAjusteArqueo(diferencia: bigint): boolean`

¿Esta diferencia de arqueo necesita un movimiento de ajuste? Cero no ajusta
nada.

```ts
import { requiereAjusteArqueo } from "@mafesoftware/tesoreria";

requiereAjusteArqueo(500n); // true
requiereAjusteArqueo(0n); // false
```

### `EstadoRendicion` / `puedeAprobarRendicion` / `puedeRechazarRendicion` / `puedeReponerRendicion`

El ciclo de una rendición de gastos (`"cargado" | "aprobado" | "rechazado" |
"repuesto"`): solo se avanza en este orden, nunca se salta un paso. Se
aprueba solo desde `"cargado"`; se rechaza desde `"cargado"` o `"aprobado"`;
se repone (se devuelve la plata) solo desde `"aprobado"`.

```ts
import { puedeAprobarRendicion, puedeRechazarRendicion, puedeReponerRendicion } from "@mafesoftware/tesoreria";

puedeAprobarRendicion("cargado"); // true
puedeAprobarRendicion("aprobado"); // false

puedeRechazarRendicion("cargado"); // true
puedeRechazarRendicion("aprobado"); // true
puedeRechazarRendicion("repuesto"); // false

puedeReponerRendicion("aprobado"); // true
puedeReponerRendicion("cargado"); // false
```
