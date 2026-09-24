# @mafesoftware/accesos

Reglas de control de acceso y cola offline idempotente. Puro.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros** salvo donde se indique. Todo lo que sale a la red acepta un
`fetch` inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/accesos
```

La documentación de cada función está en `src/index.ts`, con **el motivo de
cada decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## API

### `evaluarAcceso(socio, dispositivo, sentido, contexto)`

La decisión: entra o no, y por qué.

```ts
import { evaluarAcceso, MENSAJES } from "@mafesoftware/accesos";

const r = evaluarAcceso(
  { id: "socio-1", estado: "activo", categoriaId: "activo", alDia: false },
  { id: "molinete-1", activo: true, sentidos: ["ingreso", "egreso"], exigeCuotaAlDia: true },
  "ingreso",
  { ahora: new Date() }
);
// r: { permitido: false, motivo: "cuota_impaga", mensaje: "Cuota impaga", forzado: false }

MENSAJES.cuota_impaga; // "Cuota impaga" — el mismo texto que usa evaluarAcceso
```

Con `contexto.forzadoPor` seteado (el botón de "dejar pasar igual" de
portería), un rechazo se convierte en `permitido: true, forzado: true`, y el
`motivoOriginal` queda anotado para el registro.

### `dentroDeFranja(franjas, ahora, zona?)`

```ts
import { dentroDeFranja } from "@mafesoftware/accesos";

dentroDeFranja([{ dia: 5, desdeMinutos: 22 * 60, hastaMinutos: 2 * 60 }], new Date());
// true incluso pasada la medianoche: la franja cruza el día
```

### Sincronización offline: `reconciliar`, `aforoLuegoDe`, `armarPadron`

```ts
import { reconciliar, aforoLuegoDe, armarPadron } from "@mafesoftware/accesos";

// Un molinete sin red manda su cola cuando vuelve; puede repetir eventos.
const { aInsertar, duplicados, invalidos } = reconciliar(loteDelDispositivo, yaRegistradasEnLaBase);

aforoLuegoDe(aforoActual, aInsertar); // el aforo después de aplicar los movimientos, nunca negativo

// El padrón flaco que se sincroniza a cada dispositivo para decidir sin red.
armarPadron(sociosConSuVersionDeCarnet);
```

## Probar

```bash
bun test
```
