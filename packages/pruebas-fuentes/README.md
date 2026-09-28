# @mafesoftware/pruebas-fuentes

Detectores de reglas de código fuente para los productos de MAFE Software:
cosas que, si se olvidan, no rompen nada visible (la pantalla anda, el
typecheck pasa) y el problema aparece en producción, o no aparece nunca y
simplemente deja la puerta abierta. Pensado para correr DENTRO de un test de
vitest de la app consumidora, al estilo de `tests/fuentes.test.ts` de
gestionflow: se leen los fuentes, se corren uno o más detectores con
`correrDetectores`, y se afirma que no hay hallazgos.

**Es un devDependency**, no algo que la app despliegue: solo corre en tests.

```bash
bun add -d @mafesoftware/pruebas-fuentes
```

## Cómo se usa

```ts
// tests/fuentes.test.ts
import { describe, expect, it } from "vitest";
import {
  correrDetectores,
  guardaEnUseServer,
  leerArchivos,
  sinSqlCrudoConOr,
} from "@mafesoftware/pruebas-fuentes";

const archivos = leerArchivos(["**/*.ts", "**/*.tsx"], "src");

describe("reglas de fuentes", () => {
  it("no hay hallazgos", () => {
    const hallazgos = correrDetectores(archivos, [
      guardaEnUseServer({ nombresGuarda: ["exigirPermiso"] }),
      sinSqlCrudoConOr(),
    ]);
    expect(hallazgos, JSON.stringify(hallazgos, null, 2)).toEqual([]);
  });
});
```

## Política de falsos positivos/negativos

Los detectores son heurísticas por regex/tokens sobre el texto, **no un
parser de TypeScript** (que obligaría a cada app consumidora a cargarlo como
dependencia pesada solo para correr estos tests). Antes de aflojar un
detector porque "da un falso positivo", conviene mirar qué acepta el regex:
aflojarlo para un caso sano es exactamente cómo deja de atrapar el caso
enfermo.

Reglas generales:

- Comentarios (`//`, `/* */`) y literales de cadena (`'...'`, `"..."`,
  `` `...` ``) se ignoran ("blanquean") antes de aplicar la mayoría de los
  regex, para que una mención dentro de un comentario o un string no
  dispare un hallazgo.
- Límite conocido: un template literal con una expresión `${...}` anidada
  que a su vez contenga backticks no se sigue correctamente. Es un caso raro
  en código de aplicación.
- Cada detector documenta, en su propio comentario de `src/detectores.ts`,
  qué acepta y qué se le escapa a propósito.

## API

### `correrDetectores(archivos: ArchivoFuente[], detectores: Detector[]): Hallazgo[]`

Corre cada `detector` sobre cada `archivo` y concatena todos los `Hallazgo[]`
devueltos. Con cero archivos o cero detectores, no encuentra nada.

```ts
import { correrDetectores, sinSetHours } from "@mafesoftware/pruebas-fuentes";

correrDetectores(
  [{ ruta: "a.ts", texto: "fecha.setHours(0);" }],
  [sinSetHours()],
);
// [{ regla: "sinSetHours", archivo: "a.ts", linea: 1, detalle: "..." }]
```

### `leerArchivos(globs: string[], raiz: string): ArchivoFuente[]`

**Solo Node.js** (usa `node:fs`): recorre `raiz` recursivamente (saltando
`node_modules`/`.git`) y devuelve `{ ruta; texto }` para cada archivo cuya
ruta (relativa a `raiz`, con `/`) matchea alguno de `globs`. Soporta `*`
(dentro de un segmento) y `**` (cualquier cantidad de segmentos); no es un
matcher de propósito general. El resto del paquete es puro y no depende de
esta función — un test puede armar `ArchivoFuente[]` a mano.

```ts
import { leerArchivos } from "@mafesoftware/pruebas-fuentes";

leerArchivos(["src/**/*.ts", "**/package.json"], "/ruta/al/repo");
// [{ ruta: "src/index.ts", texto: "..." }, { ruta: "package.json", texto: "..." }, ...]
```

### `guardaEnUseServer({ nombresGuarda: string[] }): Detector`

En un archivo con `"use server"` al principio (que publica cada export como
endpoint alcanzable desde el navegador), exige que el PRIMER enunciado de
cada export `async` llame a una de `nombresGuarda` — sola o asignada (`const
x = await exigirPermiso(...)`), con o sin `await`. Reconoce estas formas
(con o sin un comentario justo antes, que no le afecta):

- `export async function nombre(...) { ... }`
- `export default async function [nombre](...) { ... }`
- `export const nombre = async (...) => { ... }`
- `export const nombre = async function [nombre](...) { ... }`
- `export const nombre = async (...) => expresion` (arrow de cuerpo
  expresión: al no haber bloque ni "primer enunciado", se considera SIN
  guarda salvo que la expresión ENTERA sea la llamada a la guarda, ej.
  `async () => exigirPermiso(x)`)

Cualquiera de estas formas puede llevar una anotación de tipo de retorno
explícita entre el `)` de los parámetros y la flecha o la llave (ej. `async
(x: string): Promise<void> => { ... }` o `async function f(x):
Promise<{ ok: true } | { ok: false }> { ... }`) sin que eso le impida
reconocer el cuerpo: una llave DENTRO del tipo (como la del objeto de esa
unión) no se confunde con la llave del cuerpo real.

```ts
import { correrDetectores, guardaEnUseServer } from "@mafesoftware/pruebas-fuentes";

const archivos = [
  {
    ruta: "acciones.ts",
    texto: `"use server";\n\nexport async function borrar(id: string) {\n  return id;\n}\n`,
  },
];
correrDetectores(archivos, [guardaEnUseServer({ nombresGuarda: ["exigirPermiso"] })]);
// [{ regla: "guardaEnUseServer", archivo: "acciones.ts", linea: 3, detalle: "borrar() no empieza..." }]
```

Límite conocido: no reconoce parámetros de tipo genéricos explícitos en un
arrow (`async <T>(x: T) => ...`, sintaxis rara y además ambigua fuera de
`.tsx`) ni un `export { nombre as default }` re-exportado más abajo — son
formas infrecuentes en server actions.

### `sinSqlCrudoConOr(): Detector`

Flagea un fragmento `` sql`...` `` de drizzle que contiene un `or` "suelto"
(rodeado de espacio en blanco), fuera de un `or(...)` de drizzle: se inserta
SIN paréntesis y puede anular el `and()` de afuera (típicamente el filtro por
tenant).

```ts
import { correrDetectores, sinSqlCrudoConOr } from "@mafesoftware/pruebas-fuentes";

const archivos = [
  { ruta: "consulta.ts", texto: "sql`estado <> 'baja' or fecha_baja >= ${desde}`" },
];
correrDetectores(archivos, [sinSqlCrudoConOr()]);
// [{ regla: "sinSqlCrudoConOr", archivo: "consulta.ts", linea: 1, detalle: "..." }]
```

### `sinCoalesceCeroEnPlata({ patrones: RegExp }): Detector`

Flagea `?? 0` en una línea que matchea `patrones` (una línea "de plata", ej.
`/monto|precio|total/i`): convierte "no se pudo leer" en "es cero" sin
avisar. Cero es un valor de plata legítimo, así que la regla no prohíbe
`?? 0` en general — solo en líneas que ya hablan de plata por su propio
patrón.

```ts
import { correrDetectores, sinCoalesceCeroEnPlata } from "@mafesoftware/pruebas-fuentes";

const archivos = [{ ruta: "form.ts", texto: "const monto = parsearPlata(v) ?? 0;" }];
correrDetectores(archivos, [sinCoalesceCeroEnPlata({ patrones: /monto|precio/i })]);
// [{ regla: "sinCoalesceCeroEnPlata", archivo: "form.ts", linea: 1, detalle: "..." }]
```

### `sinSetHours(): Detector`

Flagea `.setHours(...)`/`.setUTCHours(...)`: mutan el `Date` en el lugar y
devuelven un número (el timestamp), no el `Date` — un footgun clásico al
encadenar (`f(d.setHours(0,0,0,0))` le pasa a `f` un número).

```ts
import { correrDetectores, sinSetHours } from "@mafesoftware/pruebas-fuentes";

correrDetectores([{ ruta: "a.ts", texto: "fecha.setHours(0, 0, 0, 0);" }], [sinSetHours()]);
// [{ regla: "sinSetHours", archivo: "a.ts", linea: 1, detalle: "..." }]
```

### `serverOnlyEnDatos({ patronArchivo: RegExp }): Detector`

Un archivo cuya ruta matchea `patronArchivo` (típicamente `datosX.ts`, que lee
la base) tiene que importar `"server-only"`: es lo único que rompe el BUILD
si un componente cliente lo importa por error.

```ts
import { correrDetectores, serverOnlyEnDatos } from "@mafesoftware/pruebas-fuentes";

const archivos = [{ ruta: "src/lib/datosSocios.ts", texto: "export async function datosSocios() {}" }];
correrDetectores(archivos, [serverOnlyEnDatos({ patronArchivo: /\/datos[A-Z][A-Za-z]*\.ts$/ })]);
// [{ regla: "serverOnlyEnDatos", archivo: "src/lib/datosSocios.ts", linea: 1, detalle: "..." }]
```

### `sinImportDeDatosEnCliente({ patronDatos: RegExp }): Detector`

Un archivo `"use client"` (que el navegador bundlea) no puede importar un
módulo cuyo especificador matchea `patronDatos`: arrastra Postgres/drizzle al
bundle del cliente, y el typecheck no lo ve.

```ts
import { correrDetectores, sinImportDeDatosEnCliente } from "@mafesoftware/pruebas-fuentes";

const archivos = [
  { ruta: "Comp.tsx", texto: `"use client";\nimport { datosSocios } from "@/lib/datosSocios";\n` },
];
correrDetectores(archivos, [sinImportDeDatosEnCliente({ patronDatos: /\/datos[A-Z]/ })]);
// [{ regla: "sinImportDeDatosEnCliente", archivo: "Comp.tsx", linea: 2, detalle: "..." }]
```

### `sinDependenciaFile(): Detector`

Flagea un `package.json` con una dependencia `file:`/`link:`: apunta a una
ruta local de la máquina de quien la escribió y falla instalar en cualquier
otro lado. Solo mira archivos cuya ruta termina en `package.json`.

```ts
import { correrDetectores, sinDependenciaFile } from "@mafesoftware/pruebas-fuentes";

const archivos = [
  { ruta: "package.json", texto: JSON.stringify({ dependencies: { x: "file:../x" } }) },
];
correrDetectores(archivos, [sinDependenciaFile()]);
// [{ regla: "sinDependenciaFile", archivo: "package.json", linea: 1, detalle: "..." }]
```

### Tipos: `ArchivoFuente`, `Detector`, `Hallazgo`

```ts
interface ArchivoFuente { ruta: string; texto: string }
type Detector = (archivo: ArchivoFuente) => Hallazgo[];
interface Hallazgo { regla: string; archivo: string; linea: number; detalle: string }
```
