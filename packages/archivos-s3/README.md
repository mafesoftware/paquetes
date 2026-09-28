# @mafesoftware/archivos-s3

Subida directa a S3 con URL prefirmada, promoción a la clave final, descarga
por URL firmada con **autorización por registro** (nunca por prefijo) y
borrado en lote — para los productos de MAFE Software que guardan archivos en
un bucket privado (consult360, ediflow, y quien más lo necesite).

**La lección de ediflow.** Ahí la lectura se autorizaba por el prefijo de la
clave: alcanzaba con ser de la misma organización para leer CUALQUIER archivo
suyo, así que un vecino podía leer los comprobantes de pago de otros vecinos
(con CBU y titular), las facturas de proveedores y las evidencias de reclamos
de otras unidades — todos bajo el mismo prefijo `<orgId>/...`. `urlFirmada`
de este paquete no sabe nada de prefijos de organización: pide un callback
`quienReferencia(clave)` que la APP resuelve contra su propio esquema (quién
referencia esa clave desde qué registro), y compara ese dueño contra quien
pide la URL. Sin eso, no hay URL — nunca un 403 (que confirmaría que la
clave existe), siempre `no_encontrado`.

Parte de la familia de paquetes de MAFE Software: **núcleo puro** en el
sentido de la regla 1 de diseño del monorepo — el `S3Client` se INYECTA por
parámetro en cada función (nunca se instancia adentro, nunca lee
`process.env`), y `bucket`/credenciales entran siempre por argumento.
`@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post` y
`@aws-sdk/s3-request-presigner` son peerDependencies: los instala la app que
consume el paquete, con la versión que ya tenga.

```bash
bun add @mafesoftware/archivos-s3 @aws-sdk/client-s3 @aws-sdk/s3-presigned-post @aws-sdk/s3-request-presigner
```

Ningún error de validación se tira: todas las funciones devuelven un
resultado (`{ ok: true, ... } | { ok: false, ... }`). Un error de la llamada
a S3 en sí (red, permisos, bucket inexistente) si se propaga tal cual lo tira
el SDK — no es un error de negocio de este paquete.

## API

### `firmarSubida(opciones): Promise<ResultadoFirmarSubida>`

Presigned POST a un prefijo temporal (`"pending/"` por omisión): el
navegador sube DIRECTO a S3 con la `url`/`campos` que devuelve, sin que el
archivo pase por el server.

```ts
interface OpcionesFirmarSubida {
  cliente: S3Client;
  bucket: string;
  prefijoTemporal?: string; // "pending/" por omisión
  tipoMime: string;
  tamano: number; // declarado por el navegador — ver la nota de abajo
  nombre: string; // se sanea, nunca se usa tal cual en la clave
  mimesPermitidos: readonly string[];
  tamanoMaximo: number;
  expiraSeg?: number; // 300 por omisión
}
```

Valida ANTES de firmar nada, y nunca tira — devuelve:

- `{ ok: false, error: { codigo: "mime_no_permitido", mensaje } }` si
  `tipoMime` no está en `mimesPermitidos`.
- `{ ok: false, error: { codigo: "tamano_excedido", mensaje } }` si `tamano`
  no es un número finito positivo, o supera `tamanoMaximo`.
- `{ ok: true, url, campos, clave }` — `campos` son los campos de formulario
  que hay que mandar tal cual junto al archivo (incluye `key`, `policy`,
  `Content-Type`, la firma); `clave` es la que va a quedar en el bucket.

El `tamano` que declara el navegador es solo la entrada de ESTA validación
— la condición real que S3 aplica al aceptar el POST es
`content-length-range` (`0`..`tamanoMaximo`), así que un cliente que mienta
el `tamano` acá igual no puede subir más de `tamanoMaximo` de verdad. El
`Content-Type` queda fijo en la política (una condición `eq`): el navegador
no puede subir con un tipo distinto al validado.

```ts
import { S3Client } from "@aws-sdk/client-s3";
import { firmarSubida } from "@mafesoftware/archivos-s3";

const cliente = new S3Client({ region: "sa-east-1" }); // credenciales de la app, no de este paquete

const resultado = await firmarSubida({
  cliente,
  bucket: "obrix-archivos-650698123825",
  tipoMime: "application/pdf",
  tamano: archivo.size,
  nombre: archivo.name,
  mimesPermitidos: ["application/pdf", "image/jpeg", "image/png"],
  tamanoMaximo: 25 * 1024 * 1024,
});

if (!resultado.ok) {
  resultado.error.codigo; // "mime_no_permitido" | "tamano_excedido"
} else {
  resultado.clave; // "pending/<al azar>-<nombre saneado>" — guardar para promover()
  // el navegador arma un FormData con resultado.campos + el archivo, y hace
  // POST a resultado.url
}
```

### `promover(opciones): Promise<ResultadoPromover>`

Copia el objeto de su clave temporal a la clave final y borra la temporal —
"promueve" un archivo recién subido (`firmarSubida`) a su lugar definitivo,
una vez que la app confirmó que el registro que lo referencia se guardó.

```ts
interface OpcionesPromover {
  cliente: S3Client;
  bucket: string;
  claveTemporal: string;
  claveFinal: string;
  prefijoTemporal?: string; // tiene que coincidir con el usado en firmarSubida
}
```

Nunca tira. Devuelve `{ ok: false, error: { codigo: "clave_invalida",
mensaje } }` (sin llamar a S3 para nada) si:

- `claveTemporal` no cae bajo `prefijoTemporal` — promover CUALQUIER clave
  que alguien pase (no solo lo que `firmarSubida` generó) abriría copiar
  cualquier objeto del bucket a donde quien llama decida.
- `claveFinal` SIGUE bajo `prefijoTemporal` — dejaría un archivo "promovido"
  que `urlFirmada` trataría igual que uno recién subido y sin promover.
- cualquiera de las dos claves está vacía, arranca con `"/"`, o tiene un
  segmento `".."` (traversal).

```ts
import { promover } from "@mafesoftware/archivos-s3";

const resultado = await promover({
  cliente,
  bucket: "obrix-archivos-650698123825",
  claveTemporal: resultado.clave, // la que devolvió firmarSubida
  claveFinal: `org/${organizacionId}/comprobantes/${pagoId}.pdf`,
});

resultado.ok; // true, o false con resultado.error.codigo === "clave_invalida"
```

### `urlFirmada(opciones): Promise<ResultadoUrlFirmada>`

URL de descarga firmada (GET), autorizada **por registro** — nunca por el
prefijo de la clave (ver la lección de ediflow, arriba). Nunca tira.

```ts
interface OpcionesUrlFirmada<Dueno> {
  cliente: S3Client;
  bucket: string;
  clave: string;
  expiraSeg?: number; // 300 por omisión
  prefijoTemporal?: string; // tiene que coincidir con el usado en firmarSubida
  quienReferencia: (clave: string) => Dueno | null | Promise<Dueno | null>;
  solicitante: Dueno;
  compararSolicitante?: (dueno: Dueno, solicitante: Dueno) => boolean; // por omisión, ===
}
```

Devuelve `{ ok: false, codigo: "no_encontrado" }` (nunca un 403 — no hay que
revelar si la clave existe) en cualquiera de estos casos:

- `clave` sigue bajo `prefijoTemporal`: un archivo recién subido y todavía
  no promovido no puede estar referenciado por ningún registro de la app,
  así que tampoco tiene dueño — se corta ACÁ, **sin llamar siquiera a
  `quienReferencia`**, para que esta regla no dependa de que la app la
  implemente bien.
- `quienReferencia(clave)` devuelve `null`/`undefined`: ningún registro
  referencia esa clave.
- el dueño que devuelve `quienReferencia` no es el mismo que `solicitante`,
  según `compararSolicitante` (por omisión, `===` — pasarlo explícito
  cuando el "dueño" es un objeto, para comparar por sus campos y no por
  identidad de referencia).

```ts
import { urlFirmada } from "@mafesoftware/archivos-s3";

const resultado = await urlFirmada({
  cliente,
  bucket: "obrix-archivos-650698123825",
  clave: comprobante.clave,
  quienReferencia: async (clave) => {
    const fila = await db.query.comprobantes.findFirst({ where: eq(comprobantes.clave, clave) });
    return fila?.organizacionId ?? null; // null: nadie lo referencia (ej. archivo huérfano)
  },
  solicitante: ctx.organizacionId,
});

if (!resultado.ok) {
  resultado.codigo; // "no_encontrado" (clave de otra organización, o todavía en pending/)
} else {
  resultado.url; // GET firmado, vence en `expiraSeg`
}
```

### `borrarEnLote(opciones): Promise<ResultadoBorrarEnLote>`

Borra varias claves del bucket, en tantos requests de hasta 1000 claves como
haga falta (`DeleteObjectsCommand` de S3 no acepta más por llamada). Con
`claves: []`, devuelve `{ ok: true, borradas: 0, errores: [] }` sin llamar a
S3 para nada.

Siempre `ok: true`: un borrado parcial (una clave sin permiso, ya borrada
por otro proceso) se informa en `errores` — es el RESULTADO de la
operación, no un error de validación de entrada.

```ts
import { borrarEnLote } from "@mafesoftware/archivos-s3";

const resultado = await borrarEnLote({
  cliente,
  bucket: "obrix-archivos-650698123825",
  claves: adjuntosDelReclamoBorrado.map((a) => a.clave),
});

resultado.borradas; // cuántas se borraron de verdad
resultado.errores; // [{ clave, codigo, mensaje }] — las que S3 no pudo borrar
```

### Utilidades puras

Sin S3: útiles si la app necesita validar una clave por su cuenta.

- **`sanitizarNombre(nombre: string): string`** — deja solo
  `[A-Za-z0-9._-]` (saca acentos, colapsa el resto a `"-"`), recorta `"-"`/`"."`
  de las puntas, y devuelve `"archivo"` si no queda nada útil.
- **`esClaveSegura(clave: string): boolean`** — `false` si está vacía,
  arranca con `"/"`, o tiene un segmento `".."`.
- **`estaBajoPrefijo(clave: string, prefijo: string): boolean`** — equivalente
  a `clave.startsWith(prefijo)`, con nombre propio para que se lea la
  intención en `promover`/`urlFirmada`.
