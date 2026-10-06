# Changelog

## 0.2.0

### Minor Changes

- 6ad0993: Webhooks, media, plantillas y reconexión: lo que consult360 y ediflow escribían a mano contra Kapso.
  
  - `verificarFirmaWebhook(cuerpoCrudo, firmaHex, secreto)`: HMAC-SHA256 en hex sobre el cuerpo crudo contra `X-Webhook-Signature`, en tiempo constante (`node:crypto`, como `mercadopago-ar`). Sin secreto o sin firma da `false`.
  - `leerEventoWebhook(crudo, nombreEvento?)`: el segundo argumento es la cabecera `X-Webhook-Event` y manda sobre `cuerpo.event`/`cuerpo.type`. **Kapso no pone el nombre del evento en el cuerpo v2**: sin la cabecera, un mensaje real sale `"ignorado"`. Llamarla sin el segundo argumento sigue funcionando igual que antes.
  - `leerEventosWebhook(crudo, nombreEvento?)`: desarma el sobre de lote (`batch: true, data: [...]`) que manda Kapso con buffering. `leerEventoWebhook` con un lote ahora devuelve `"ignorado"` diciendo que se use ésta, en vez de leerlo mal.
  - Mensajes entrantes: `tipo` suma `"imagen" | "video" | "documento" | "audio" | "ubicacion"`, con `media?: { id, mimeType?, nombreArchivo?, url? }` (`url` = `message.kapso.media_url`), el epígrafe en `texto` y la ubicación como `"lat,lng"`. Se agrega `nombreContacto?` (`conversation.contact_name`). El botón de respuesta rápida de una plantilla (`type: "button"`) sale como `"boton"` con su payload. Si falta `from`, el remitente sale de `conversation.phone_number`.
  - Estados: `failed` trae `error?: { codigo?, titulo?, mensaje? }` del último elemento de `message.kapso.statuses`. La `fechaHora` de un estado v2 ahora sale del historial o de `message.timestamp` (antes, con el payload v2, quedaba en "ahora").
  - Conexión de número: lee `customer.id` del payload v2 (`{ phone_number_id, customer: { id, external_id } }`); antes solo miraba `customer_id` suelto y el evento real salía `"ignorado"`. Suma `idExterno?` (`customer.external_id`).
  - `bajarMedia(cred, mediaId)`: `GET /{media_id}?phone_number_id=…` → `download_url` (4 minutos, auth incluida) → bytes, sin mandar la clave al segundo paso.
  - `registrarWebhookNumero(cred, phoneNumberId, { url, secreto, eventos? })` (kind `kapso`, por defecto `EVENTOS_WEBHOOK_NUMERO`: received/delivered/read/failed) y `listarWebhooksNumero(cred, phoneNumberId)`.
  - `crearPlantilla(cred, wabaId, definicion)` y `listarPlantillas(cred, wabaId, opciones?)` por el proxy de Meta (`/{waba_id}/message_templates`), con nombre y estado.
  - `crearSetupLink` suma `reconectarTelefono` (`reconnect_phone_number`); en ese caso no manda `allowed_connection_types` (Kapso lo fija al de la conexión existente y da 422 si no coincide) ni `meta_billing_mode` salvo que se pase.
  - `crearCliente`: se documenta que cada app tiene que pasar su prefijo; el default `"gestionflow"` queda solo por compatibilidad.
  - Nuevo tipo exportado `CredencialesPlataforma` (`{ apiKey, fetch?, timeoutMs? }`).
  
  **Cambio de comportamiento a revisar al actualizar**: un audio, una imagen, un video o un documento entrante antes salía `tipo: "otro"` y ahora sale con su propio tipo. Una app que filtraba media con `m.tipo === "otro"` (GestionFlow lo hace para no contestarle a una nota de voz) tiene que pasar a filtrar por `m.tipo !== "texto"` o similar.

## 0.1.2

### Patch Changes

- Agrega la condición `"default"` a cada entrada de `exports` (raíz y subpaths,
  como `/drizzle` o `/next`), justo después de `"import"`.
  
  Sin esto, `drizzle-kit generate` (y cualquier otro loader que resuelva vía
  CJS, incluido `require(esm)` de Node ≥22) fallaba con
  `ERR_PACKAGE_PATH_NOT_EXPORTED` al importar, por ejemplo,
  `@mafesoftware/tenant/drizzle` desde un `schema.ts`: el `exports` map solo
  tenía condiciones `types` e `import`, y ninguna que un resolver CJS supiera
  interpretar.
  
  `"default"` apunta al mismo archivo `.js` que `"import"` — el paquete sigue
  siendo ESM puro, no se agrega ningún build CJS — pero al ser la condición de
  más baja prioridad, un loader que no entiende `"import"` cae en ella igual.
  
  Sin cambios de API pública.

## 0.1.1

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.

## 0.1.0

WhatsApp por Kapso (proxy de la Cloud API de Meta): normalización de números
argentinos (`aNumeroWhatsApp`), envío de texto, plantillas, botones y listas
(`enviarTexto`, `enviarPlantilla`, `enviarBotones`, `enviarLista`,
`enviarAviso`), onboarding de un club (`crearCliente`, `crearSetupLink`) y
lectura del webhook entrante (`leerEventoWebhook`). `fetch` inyectable,
resultados en vez de excepciones.
