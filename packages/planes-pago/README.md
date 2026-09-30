# @mafesoftware/planes-pago

Generación y validación de planes de pago en cuotas. Puro: sin DB, sin
framework — entran datos, salen resultados.

Parte de la familia de paquetes de MAFE Software: sin dependencias de
framework, sin ORM. Toda la plata se maneja en **centavos** (`bigint`), vía
`@mafesoftware/plata-ar`; los vencimientos, vía `@mafesoftware/fechas-ar`.

```bash
bun add @mafesoftware/planes-pago
```

La documentación de cada función está en `src/`, con **el motivo de cada
decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## Probar

```bash
bun test
```

## API

### `generarCuotas(condicion: Condicion, feriados: ReadonlySet<string>): CuotaGenerada[]`

Genera las cuotas de una condición de pago: monto base por cuota (sin ajuste
por índice — eso lo aplica quien consuma el resultado) y vencimiento, movido
al siguiente día hábil cuando cae en fin de semana o feriado.

```ts
import { generarCuotas, type Condicion } from "@mafesoftware/planes-pago";

const condicion: Condicion = {
  concepto: "Saldo en cuotas",
  moneda: "ARS",
  total: 1_000_000_000n, // $10.000.000,00
  cuotas: 36,
  periodicidad: "mensual",
  primeraFecha: "2026-01-15",
  diaVencimiento: 15,
  sistema: "iguales",
};

const feriados = new Set(["2026-02-16"]);
const cuotas = generarCuotas(condicion, feriados);
// [{ numero: 1, de: 36, vencimiento: "2026-01-15", montoBase: 27_777_778n, moneda: "ARS", concepto: "Saldo en cuotas" }, …]
```

**Sistemas de reparto** (`Condicion.sistema`):

- `"iguales"`: todas las cuotas iguales salvo la última, que absorbe la
  diferencia de redondeo — la suma siempre da el total exacto.
- `{ tipo: "variacion", porcentaje: "2" }`: cada cuota vale `porcentaje`%
  menos que la anterior (geométrico), repartido por mayor resto.
- `{ tipo: "manual", montos: [...], fechas?: [...] }`: los montos (y,
  opcionalmente, las fechas) los define quien arma el plan. La suma de
  `montos` tiene que coincidir con `total` — si no, `generarCuotas` tira en
  vez de generar cuotas que no cuadran.

**Periodicidad** (`Condicion.periodicidad`): `"mensual" | "bimestral" |
"trimestral" | "cuatrimestral" | "semestral" | "anual" | "libre"`. Con
`"libre"` no hay paso fijo: `sistema` tiene que ser `"manual"` con `fechas`
explícitas.

### `validarPlan(valorCerrado: Importe, condiciones: Condicion[], tcPactado?: string): ResultadoValidacion`

Valida que la suma de lo pactado en cada condición (anticipo, cuotas, entrega
final...) cierre EXACTO contra `valorCerrado` — ni un centavo de diferencia.
Cuando una condición está en otra moneda que `valorCerrado`, se convierte con
`tcPactado` (el tipo de cambio con el que se cerró el plan) antes de sumar;
sin `tcPactado`, una condición en otra moneda hace que la función tire, no
que se valide mal en silencio.

```ts
import { validarPlan } from "@mafesoftware/planes-pago";
import type { Importe } from "@mafesoftware/plata-ar";

const valorCerrado: Importe = { centavos: 10_000_000_000n, moneda: "ARS" }; // $100.000.000,00
const condiciones = [
  { concepto: "Anticipo", moneda: "USD", total: 3_000_000n, cuotas: 1, periodicidad: "mensual", primeraFecha: "2026-01-15", diaVencimiento: 15, sistema: "iguales" as const },
  { concepto: "Cuotas", moneda: "ARS", total: 7_000_000_000n, cuotas: 12, periodicidad: "mensual", primeraFecha: "2026-02-15", diaVencimiento: 15, sistema: "iguales" as const },
];

validarPlan(valorCerrado, condiciones, "1000"); // { ok: true }
```

Un desajuste devuelve `{ ok: false, diferencia: Importe }` — nunca lanza por
un desajuste de plata; solo lanza por un error de quien arma el plan (falta
`tcPactado`, sistema manual con montos que no cuadran, etc.).
