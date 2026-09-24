# @mafesoftware/cuotas

Motor de cuotas: periodos, recargo por mora e imputacion de pagos. Puro.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros** salvo donde se indique. Todo lo que sale a la red acepta un
`fetch` inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/cuotas
```

La documentación de cada función está en `src/index.ts`, con **el motivo de
cada decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## Probar

```bash
bun test
```

## API

### Deuda y saldo

```ts
import { saldo, diasDeAtraso } from "@mafesoftware/cuotas";

const deuda = { id: "jul", vencimiento: "2026-07-10", importe: 100_000, pagado: 40_000 };
saldo(deuda);              // 60_000 (importe - pagado, nunca negativo)
diasDeAtraso(deuda, "2026-09-20"); // 72
```

### Recargo por mora

```ts
import { calcularRecargo, totalAPagar, type EsquemaRecargo } from "@mafesoftware/cuotas";

const esquema: EsquemaRecargo = {
  escalones: [{ diasVencido: 10, porcentaje: 10 }],
  topePorcentaje: 20,
};
calcularRecargo(deuda, "2026-09-20", esquema); // el recargo sobre el saldo, topeado
totalAPagar(deuda, "2026-09-20", esquema);     // saldo + recargo
```

### Estado del socio e imputación de pagos

```ts
import { imputarPago, resumirDeuda } from "@mafesoftware/cuotas";

const deudas = [
  { id: "jul", vencimiento: "2026-07-10", importe: 100_000 },
  { id: "ago", vencimiento: "2026-08-10", importe: 100_000 },
];

resumirDeuda(deudas, "2026-09-20").estado; // "moroso"

// Las más viejas primero, y dentro de cada una el recargo antes que el capital.
const r = imputarPago(150_000, deudas, { hoy: "2026-09-20" });
r.imputaciones; // [{ deudaId: "jul", total: 100_000, cancelada: true }, { deudaId: "ago", total: 50_000, … }]
r.aFavor;       // 0
```

**La invariante:** `aplicado + aFavor === importe`, siempre. Lo que entra sale:
repartido entre deudas más, si sobra, un saldo a favor explícito.

### Emisión de un período

```ts
import { prorratear, emitirPeriodo, vencimientosDe } from "@mafesoftware/cuotas";

prorratear(100_000, { desdeISO: "2026-09-01", hastaISO: "2026-09-30", altaISO: "2026-09-20" });
// 11/30 de la cuota: lo que corresponde desde que el socio se asoció

const cuotas = emitirPeriodo(
  [{ id: "socio-1", importe: 100_000, grupoFamiliarId: "flia-1" }, { id: "socio-2", importe: 100_000, grupoFamiliarId: "flia-1" }],
  { desdeISO: "2026-09-01", hastaISO: "2026-09-30", descuentoFamiliarPorcentaje: 20 }
);
// socio-2 (no es el primero del grupo) sale con el renglón de descuento

vencimientosDe("2026-09-10", 10); // { primero: "2026-09-10", segundo: "2026-09-20" }
```
