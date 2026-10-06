# @mafesoftware/kapso-wa

WhatsApp por Kapso (proxy de la Cloud API de Meta). fetch inyectable.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros** salvo donde se indique. Todo lo que sale a la red acepta un
`fetch` inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/kapso-wa
```

La documentación de cada función está en `src/index.ts`, con **el motivo de
cada decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## API

### Números

```ts
import { aNumeroWhatsApp } from "@mafesoftware/kapso-wa";

aNumeroWhatsApp("011 4567-8901");     // "5491145678901"
aNumeroWhatsApp("+54 9 11 4567 8901"); // "5491145678901"
aNumeroWhatsApp("no es un teléfono"); // null (nunca un número adivinado)
```

### Envío de mensajes

Todas devuelven `Resultado` (`{ ok: true, id }` o `{ ok: false, categoria, error }`) y **nunca tiran**.

```ts
import { enviarTexto, enviarPlantilla, enviarBotones, enviarLista, enviarAviso, dentroDeVentana24h } from "@mafesoftware/kapso-wa";

const cred = { apiKey: "kapso_...", phoneNumberId: "1234567890" };

await enviarTexto(cred, "5491145678901", "¡Gracias por tu reserva!"); // solo dentro de la ventana de 24h

await enviarPlantilla(cred, "5491145678901", "gf_cuota_vence", ["Juana", "$12.000"]); // fuera de la ventana

await enviarBotones(cred, "5491145678901", "¿Confirmás tu turno?", [
  { id: "reserva:confirmar", titulo: "Confirmar" },
  { id: "reserva:cancelar", titulo: "Cancelar" },
]);

await enviarLista(cred, "5491145678901", "Turnos libres:", "Ver turnos", [
  { titulo: "Cancha 1", opciones: [{ id: "turno:1", titulo: "18:00" }] },
]);

// Elige sola: texto si escribió hace menos de 24h, plantilla si no.
await enviarAviso(cred, "5491145678901", {
  ultimoMensajeEntrante: ultimaVezQueEscribio,
  texto: "Tu cuota de septiembre está vencida.",
  plantilla: "gf_cuota_vence",
  parametros: ["septiembre"],
});

dentroDeVentana24h(ultimaVezQueEscribio); // true | false
```

### Onboarding de un club

```ts
import { crearCliente, crearSetupLink } from "@mafesoftware/kapso-wa";

const cred = { apiKey: "kapso_..." };
// Cada app pasa SU prefijo: el proyecto de Kapso es uno solo para todo MAFE
// Software, y el default "gestionflow" queda solo por compatibilidad.
const r = await crearCliente(cred, "Club Náutico", clubId, "padel360");
if (r.ok) {
  const link = await crearSetupLink(cred, r.cliente.id, { volverBienA: "https://app/ok" });
  if (link.ok) redirigirA(link.url); // el club conecta su WhatsApp ahí
}

// Si la credencial de un número ya conectado se rompió, un link atado a ESE número:
await crearSetupLink(cred, clienteId, { reconectarTelefono: "+5491145678901" });
```

### Webhook del número

Los mensajes llegan por un webhook **de cada número** (el de proyecto solo trae
conexiones). Se registra una vez, al conectarse el número; el secreto lo elige
la app.

```ts
import { registrarWebhookNumero, listarWebhooksNumero, EVENTOS_WEBHOOK_NUMERO } from "@mafesoftware/kapso-wa";

const cred = { apiKey: "kapso_..." };
const ya = await listarWebhooksNumero(cred, phoneNumberId);
if (ya.ok && !ya.webhooks.some((w) => w.url === urlWebhook)) {
  await registrarWebhookNumero(cred, phoneNumberId, { url: urlWebhook, secreto: secretoWebhook });
  // eventos por defecto: EVENTOS_WEBHOOK_NUMERO (received, delivered, read, failed)
}
```

### Webhook entrante

```ts
import { verificarFirmaWebhook, leerEventosWebhook, leerEventoWebhook } from "@mafesoftware/kapso-wa";

export async function POST(request: Request) {
  const crudo = await request.text(); // el cuerpo CRUDO: re-serializarlo rompe la firma
  if (!verificarFirmaWebhook(crudo, request.headers.get("x-webhook-signature"), secretoWebhook)) {
    return new Response("firma inválida", { status: 401 });
  }
  // El nombre del evento viene en la CABECERA, no en el cuerpo.
  const nombre = request.headers.get("x-webhook-event");
  // Con buffering, Kapso manda un lote ({ batch: true, data: [...] }): leerEventosWebhook lo desarma.
  for (const evento of leerEventosWebhook(JSON.parse(crudo), nombre)) {
    if (evento.tipo === "mensaje") {
      // evento.mensaje: { tipo, de, phoneNumberId, texto, payload?, media?, nombreContacto?, mensajeId, fechaHora }
    } else if (evento.tipo === "estado" && evento.estado === "failed") {
      // evento.error?: { codigo: 131047, titulo, mensaje }
    } else if (evento.tipo === "numero_conectado") {
      // evento.clienteId (Kapso), evento.idExterno ("<prefijo>:<id>")
    }
    // "ignorado": de otra app o que no se reconoce — el webhook igual contesta 200
  }
  return new Response("ok");
}

// Un evento suelto (sin buffering) también se puede leer de a uno:
const evento = leerEventoWebhook(JSON.parse(crudo), request.headers.get("x-webhook-event"));
```

### Media entrante

```ts
import { bajarMedia } from "@mafesoftware/kapso-wa";

if (evento.tipo === "mensaje" && evento.mensaje.media) {
  // `media.url` (message.kapso.media_url) suele venir ya listo; por id:
  const r = await bajarMedia({ apiKey: "kapso_...", phoneNumberId }, evento.mensaje.media.id);
  if (r.ok) await guardar(r.bytes, r.mimeType); // Uint8Array
}
```

### Plantillas

```ts
import { crearPlantilla, listarPlantillas } from "@mafesoftware/kapso-wa";

const cred = { apiKey: "kapso_..." };
const r = await crearPlantilla(cred, wabaId, {
  nombre: "ef_expensa_vence",
  categoria: "UTILITY",
  componentes: [{ type: "BODY", text: "Hola {{1}}, tu expensa vence el {{2}}.", example: { body_text: [["Juana", "10/11"]] } }],
});
// r.plantilla.estado === "PENDING" hasta que Meta la revisa

const lista = await listarPlantillas(cred, wabaId, { estado: "APPROVED" });
if (lista.ok) lista.plantillas.map((p) => `${p.nombre}: ${p.estado}`);
```

## Probar

```bash
bun test
```
