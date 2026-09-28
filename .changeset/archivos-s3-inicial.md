---
"@mafesoftware/archivos-s3": minor
---

Primer release del paquete (0.1.0): subida directa a S3 con URL prefirmada,
promoción a la clave final, descarga por URL firmada con **autorización por
registro** (nunca por prefijo) y borrado en lote.

- **`firmarSubida`**: presigned POST a un prefijo temporal (`"pending/"` por
  omisión) — valida tipo MIME (lista cerrada) y tamaño ANTES de firmar,
  nunca tira (`{ ok: false, error: { codigo: "mime_no_permitido" |
  "tamano_excedido", mensaje } }`). La condición `content-length-range`
  hace que S3 mismo rechace un POST más grande que `tamanoMaximo` aunque el
  `tamano` declarado por el navegador mienta; el `Content-Type` queda fijo
  en la política.
- **`promover`**: copia el objeto de su clave temporal a la clave final y
  borra la temporal. Rechaza (`codigo: "clave_invalida"`, sin llamar a S3)
  una `claveTemporal` que no esté bajo el prefijo esperado, una `claveFinal`
  que siga bajo ese prefijo, o cualquiera de las dos con traversal (`".."`,
  `"/"` inicial).
- **`urlFirmada`**: URL de descarga firmada, autorizada por un callback
  `quienReferencia(clave)` que la APP resuelve contra su propio esquema —
  **la lección de ediflow**: ahí la lectura se autorizaba por el prefijo de
  la clave (bastaba ser de la misma organización), así que un vecino podía
  leer los comprobantes de pago de otros vecinos, las facturas de
  proveedores y las evidencias de reclamos de otras unidades. Acá, sin un
  registro que referencie la clave y cuyo dueño coincida con `solicitante`
  (comparado con `compararSolicitante`, por omisión `===`), no hay URL —
  siempre `{ ok: false, codigo: "no_encontrado" }`, nunca un 403 que
  confirme que la clave existe. Una clave que sigue bajo el prefijo
  temporal nunca es descargable, ni siquiera se llega a preguntar
  `quienReferencia`.
- **`borrarEnLote`**: hasta 1000 claves por request (el límite de
  `DeleteObjectsCommand`), en tantos lotes como haga falta; un borrado
  parcial se informa en `errores` sin fallar la operación.

**Núcleo puro** (regla 1 de diseño del monorepo): el `S3Client` se inyecta
por parámetro en cada función — nunca se instancia adentro, nunca lee
`process.env`; bucket y credenciales entran siempre por argumento.
`@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post` y
`@aws-sdk/s3-request-presigner` son peerDependencies. El código que arma los
comandos de S3 vive en `src/aws/` — la única subcarpeta del núcleo, junto a
`src/drizzle/`/`src/next/` de otros paquetes, donde el monorepo permite
importar `@aws-sdk/*` (ver `tests/lib/verificar-paquete.ts`).
