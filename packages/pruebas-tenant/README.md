# @mafesoftware/pruebas-tenant

Harness de aislamiento entre tenants para los productos multi-tenant de MAFE
Software: dado un registro de casos (qué operación probar) y una función
`sembrar` que arma dos tenants aislados A y B, corre cada caso **como tenant
B** contra un id que pertenece a A, y clasifica el resultado (o la excepción)
como "filtra" (fuga) o "no encontrado" — que es lo único que un tenant ajeno
puede ver sin que sea una fuga.

**Es un devDependency**, no algo que la app despliegue: solo corre en tests.
Núcleo puro (`probarAislamiento`, sin vitest ni base de datos — todo entra
por parámetro); el helper que registra un `it` por caso vive en el subpath
`/vitest` (`vitest` como peerDependency **opcional**, solo ahí).

```bash
bun add -d @mafesoftware/pruebas-tenant
```

## Cómo se usa

```ts
// tests/aislamiento.test.ts
import { describeAislamiento } from "@mafesoftware/pruebas-tenant/vitest";
import { buscarPedido, sembrarDosComercios } from "../fixtures";

describeAislamiento({
  sembrar: sembrarDosComercios, // -> { a, b, idDeA }
  esNoEncontrado: (r) => r === null,
  casos: [
    {
      nombre: "buscarPedido no ve el pedido de otro comercio",
      ejecutar: ({ tenant, idAjeno }) => buscarPedido(tenant.id, idAjeno),
    },
  ],
});
```

Cada caso corre `ejecutar` con el tenant B (`ctx.tenant`) contra un id que
pertenece al tenant A (`ctx.idAjeno`). Si `ejecutar` devuelve algo (o tira
algo) que `esNoEncontrado` NO clasifica como "no encontrado", es una fuga: B
vio, o pudo confirmar la existencia de, un recurso de A.

`sembrar()` se llama **una vez por caso**, no una sola vez para toda la
corrida: así un caso que muta datos (confirma, cancela, borra) no deja al
siguiente con el estado cambiado, y el orden de `casos` no importa.

## API

### `probarAislamiento(opciones): Promise<ResultadoAislamiento[]>`

Núcleo puro. Corre cada caso de `opciones.casos` como tenant B contra un id
de A y devuelve `{ nombre; ok; detalle }[]` — nunca tira por un caso que
filtra (eso queda en `ok: false` para que quien llama decida cómo fallar); sí
propaga si `sembrar()` mismo tira, porque eso es un fixture roto, no un
hallazgo de aislamiento.

```ts
import { probarAislamiento } from "@mafesoftware/pruebas-tenant";

const resultados = await probarAislamiento({
  casos: [
    {
      nombre: "buscarConFiltro filtra por tenant",
      ejecutar: ({ tenant, idAjeno }) => buscarConFiltro(tenant, idAjeno),
    },
    {
      // A propósito con la fuga, para mostrar cómo se reporta:
      nombre: "buscarSinFiltro NO filtra",
      ejecutar: ({ tenant, idAjeno }) => buscarSinFiltro(tenant, idAjeno),
    },
  ],
  sembrar: async () => {
    const a = { id: "a" };
    const b = { id: "b" };
    db.set("recurso-1", { tenantId: "a", secreto: "x" });
    return { a, b, idDeA: "recurso-1" };
  },
  esNoEncontrado: (r) => r === null,
});
// [
//   { nombre: "buscarConFiltro filtra por tenant", ok: true, detalle: "..." },
//   { nombre: "buscarSinFiltro NO filtra", ok: false, detalle: "filtró: ... secreto: \"x\" ..." },
// ]
```

### `describeAislamiento(opciones)` (subpath `@mafesoftware/pruebas-tenant/vitest`)

Registra, con `it` de vitest, un test por cada caso de `opciones.casos`:
corre `probarAislamiento` con ESE único caso y hace fallar el test —con el
`detalle` del hallazgo en el mensaje— si no clasificó como "no encontrado".
Se llama al nivel superior de un archivo de test (o dentro de un propio
`describe(...)`), igual que `it.each`.

```ts
import { describeAislamiento } from "@mafesoftware/pruebas-tenant/vitest";

describeAislamiento({
  casos: [
    { nombre: "un vecino no ve la cuota del otro club", ejecutar: ({ tenant, idAjeno }) => buscarCuota(tenant, idAjeno) },
  ],
  sembrar: sembrarDosClubes,
  esNoEncontrado: (r) => r === null,
});
// registra: it("aislamiento: un vecino no ve la cuota del otro club", async () => { ... })
```

### Tipos: `CasoAislamiento`, `OpcionesProbarAislamiento`, `ResultadoAislamiento`

```ts
interface CasoAislamiento<T> {
  nombre: string;
  ejecutar: (ctx: { tenant: T; idAjeno: string }) => Promise<unknown>;
}

interface OpcionesProbarAislamiento<T> {
  casos: CasoAislamiento<T>[];
  sembrar: () => Promise<{ a: T; b: T; idDeA: string }>;
  esNoEncontrado: (resultadoOError: unknown) => boolean;
}

interface ResultadoAislamiento {
  nombre: string;
  ok: boolean;
  detalle: string;
}
```
