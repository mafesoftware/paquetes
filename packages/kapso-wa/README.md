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
const r = await crearCliente(cred, "Club Náutico", clubId);
if (r.ok) {
  const link = await crearSetupLink(cred, r.cliente.id, { volverBienA: "https://app/ok" });
  if (link.ok) redirigirA(link.url); // el club conecta su WhatsApp ahí
}
```

### Webhook entrante

```ts
import { leerEventoWebhook } from "@mafesoftware/kapso-wa";

const evento = leerEventoWebhook(cuerpoDelWebhook); // nunca tira
if (evento.tipo === "mensaje") {
  // evento.mensaje: { tipo, de, phoneNumberId, texto, payload?, mensajeId, fechaHora }
} else if (evento.tipo === "ignorado") {
  // evento de otra aplicación, o que no se reconoce — el webhook igual contesta 200
}
```

## Probar

```bash
bun test
```
