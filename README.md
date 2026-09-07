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

## Ejemplo

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
