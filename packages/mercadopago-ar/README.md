# @mafesoftware/mercadopago-ar

Integración de Mercado Pago para Argentina: **Checkout Pro**, **OAuth de
marketplace** y **webhooks**. Sin dependencias, sin ORM, sin framework.

Nace de una integración que ya funciona en producción, sacándole todo lo que era
de esa aplicación en particular.

## Qué es y qué no es

**Es** el protocolo de Mercado Pago con las decisiones difíciles ya tomadas:
verificación de firma, idempotencia frente a webhooks duplicados, reconciliación
cuando un aviso se pierde, y el manejo de los cinco lugares distintos donde MP
manda el id de un pago.

**No es** una capa de datos. El paquete **nunca toca tu base**: pone el *orden*
de las operaciones y vos ponés la persistencia por callbacks. Por eso sirve
igual con Prisma, con Drizzle o con SQL a mano.

Tampoco lee `process.env`: las credenciales entran por parámetro. Y todo lo que
habla con MP acepta un `fetch` opcional, así tus tests corren sin red.

## Instalación

```bash
npm install @mafesoftware/mercadopago-ar
```

Node >= 20. Es código de **servidor**: usa `node:crypto` para verificar la firma.

Tu aplicación necesita, de su propio entorno:

| Variable | Para qué |
|---|---|
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | Tu aplicación en MP Developers, para el OAuth |
| `MP_WEBHOOK_SECRET` | La clave con la que MP firma los avisos |

No hace falta un access token de plataforma: la preferencia se firma con el
token de la vendedora y la comisión viaja adentro.

## Los tres flujos

### 1. Vincular la cuenta de la vendedora

```ts
import { randomUUID } from "node:crypto";
import { iniciarVinculacion, resolverVinculacion } from "@mafesoftware/mercadopago-ar/next";
import { canjearCodigo } from "@mafesoftware/mercadopago-ar";

// GET /api/mercadopago/vincular
const { url, cookies } = iniciarVinculacion({
  clientId: process.env.MP_CLIENT_ID!,
  redirectUri: "https://mitienda.com/api/mercadopago/callback",
  objetivo: tenantId,           // a quién estás vinculando
  nonce: randomUUID(),          // anti-CSRF
  volverA: "/admin/pagos",      // solo paths internos
});
// ...escribís las cookies en la respuesta y redirigís a `url`

// GET /api/mercadopago/callback
const r = resolverVinculacion({ url: request.url, leerCookie });
if (!r.ok) return /* mostrar el error segun r.motivo */;

// Acá va TU autorización: ¿esta persona puede vincular esta tienda?
// El paquete no puede decidirlo.
const tokens = await canjearCodigo({
  code: r.code,
  redirectUri: "https://mitienda.com/api/mercadopago/callback",
  app: { clientId: process.env.MP_CLIENT_ID!, clientSecret: process.env.MP_CLIENT_SECRET! },
});
// ...y los guardás vos, donde quieras
```

Los tokens vencen. Antes de usarlos:

```ts
import { necesitaRefresco, refrescarToken } from "@mafesoftware/mercadopago-ar";

if (necesitaRefresco(credenciales.expiraEn)) {
  const nuevos = await refrescarToken({ refreshToken: credenciales.refreshToken, app });
  // guardarlos
}
```

### 2. Cobrar

```ts
import { crearPreferencia } from "@mafesoftware/mercadopago-ar";

const pref = await crearPreferencia({
  accessToken: credencialesDeLaVendedora.accessToken,
  items: [{ id: "sku-1", titulo: "Serum", cantidad: 2, precioUnitario: 12000 }],
  referenciaExterna: pedido.id,       // por acá vuelve el pago
  urlDeNotificacion: "https://mitienda.com/api/mercadopago/webhook",
  urlsDeVuelta: {
    exito: "https://mitienda.com/cuenta?pago=exito",
    error: "https://mitienda.com/cuenta?pago=error",
    pendiente: "https://mitienda.com/cuenta?pago=pendiente",
  },
  comisionEnPuntosBasicos: 250,        // 2,5%. 0 u omitido = sin comisión
  venceEn: new Date(Date.now() + 30 * 60_000),
  descriptorEnResumen: "MITIENDA",
});

redirigir(pref.initPoint);
```

### 3. Recibir el aviso

```ts
// app/api/mercadopago/webhook/route.ts
import { rutaWebhook } from "@mafesoftware/mercadopago-ar/next";
import { procesarNotificacionDePago } from "@mafesoftware/mercadopago-ar";

export const POST = rutaWebhook({
  secreto: process.env.MP_WEBHOOK_SECRET ?? null,
  alRecibirPago: async (pagoId) => {
    await procesarNotificacionDePago({
      pagoId,
      accessToken: await tokenDeLaTienda(),

      cargarPedido: async (referencia) => {
        const p = await db.pedido(referencia);
        return p ? { estadoPago: p.estadoPago } : null;
      },

      // Condicionado al estado de origen: de dos webhooks simultáneos
      // gana uno solo. Devolvé si afectó filas.
      aplicar: async ({ referenciaExterna, pagoId, estado }) => {
        const filas = await db.actualizarSiEstadoEs(referenciaExterna, {
          estadoPago: estado,
          pagoId,
        });
        return filas > 0;
      },
    });
  },
});
```

Y la red de abajo, para cuando un aviso se pierde — al volver de MP, o antes de
dar un pedido por vencido:

```ts
import { reconciliarPago } from "@mafesoftware/mercadopago-ar";

await reconciliarPago({
  referenciaExterna: pedido.id,
  accessToken: await tokenDeLaTienda(),
  cargarPedido,
  aplicar,   // los mismos puertos
});
```

## API

Los flujos de arriba ya muestran `iniciarVinculacion`, `resolverVinculacion`,
`canjearCodigo`, `necesitaRefresco`, `refrescarToken`, `crearPreferencia`,
`rutaWebhook`, `procesarNotificacionDePago` y `reconciliarPago`. El resto de lo
que exporta el paquete:

```ts
import { mapearEstado, traerPago, buscarPagosPorReferencia, pagoMasRelevante } from "@mafesoftware/mercadopago-ar";

mapearEstado("in_process");        // "pendiente"
mapearEstado("algo-que-mp-invente"); // "pendiente" (lo desconocido cae acá, nunca en "aprobado")

await traerPago({ pagoId: "123", accessToken }); // PagoMP | null
await buscarPagosPorReferencia({ referenciaExterna: pedido.id, accessToken }); // PagoMP[]
pagoMasRelevante(pagos); // el que manda: gana el contracargo, después el aprobado…
```

```ts
import { calcularComision } from "@mafesoftware/mercadopago-ar";

calcularComision([{ id: "sku-1", titulo: "Serum", cantidad: 2, precioUnitario: 12000 }], 250);
// 600 (2,5% de $24.000, redondeado)
```

```ts
import { verificarFirmaWebhook, leerNotificacion } from "@mafesoftware/mercadopago-ar";

verificarFirmaWebhook({
  cabeceraFirma: request.headers.get("x-signature"),
  requestId: request.headers.get("x-request-id"),
  dataId: "123456",
  secreto: process.env.MP_WEBHOOK_SECRET ?? null,
}); // false sin secreto configurado y sin permitirSinSecreto: true

leerNotificacion({ url: request.url, cuerpo: await request.json() });
// { tipo: "payment", dataId: "123456", esPago: true, esContracargo: false }
```

```ts
import { esTransitorio, ErrorMP, urlDeAutorizacion } from "@mafesoftware/mercadopago-ar";
import { esPathInterno } from "@mafesoftware/mercadopago-ar/next";

esTransitorio(error); // true si conviene que MP reintente (categoría "red", o un error que no es ErrorMP)
new ErrorMP("credenciales", "token vencido"); // .categoria, .estadoHttp?, .detalle?
urlDeAutorizacion({ clientId, redirectUri, state: "tenant:nonce" }); // la URL de OAuth de MP
esPathInterno("/admin/pagos"); // true; esPathInterno("//evil.com") // false (evita el open redirect)
```

## Estados

MP tiene muchos estados; el paquete los reduce a cinco:

| Canónico | De MP |
|---|---|
| `aprobado` | `approved`, `authorized` |
| `pendiente` | `pending`, `in_process`, `in_mediation`, **y todo lo desconocido** |
| `rechazado` | `rejected`, `cancelled` |
| `devuelto` | `refunded` |
| `contracargo` | `charged_back` |

## Decisiones que parecen detalles

**Con comisión 0 no se manda `application_fee`.** MP rechaza el valor 0, así que
el campo se omite. Si arrancás sin comisión y la subís después, no hay que tocar
nada más que el número.

**Sin secreto de webhook, la firma RECHAZA por defecto.** Un webhook sin firma
verificable deja que cualquiera POSTee "este pago está aprobado" y se lleve la
mercadería. Para probar en local está `permitirSinSecreto: true`, y es la app la
que decide cuándo prenderlo — el paquete no mira `NODE_ENV`.

**El webhook responde 500 cuando el fallo fue pasajero.** Es tentador responder
200 siempre para que MP no te inunde de reintentos, pero el reintento de MP es
tu red de seguridad: si tu base estuvo caída dos segundos y respondiste 200, ese
aviso no vuelve nunca y el pedido queda impago aunque la clienta pagó. Entonces:
200 cuando reintentar no cambiaría nada, 500 cuando sí.

**Nunca se le cree al cuerpo del webhook.** El aviso solo aporta un id; el estado
del pago se le vuelve a preguntar a la API de MP. El body es forjable y además
llega desordenado.

**`pagoMasRelevante` no elige el último.** Una clienta puede tener tres rechazos
y un aprobado: vale el aprobado. El contracargo sí le gana al aprobado, porque
es lo último que pasó de verdad con esa plata.

**Si MP no devuelve un `refresh_token` nuevo, se conserva el anterior.**
Pisarlo con `null` desvincula la tienda sin que nadie haya hecho nada.

## Desarrollo

```bash
npm install
npm test          # 86 tests, ninguno toca la red
npm run typecheck
npm run build
```

## Licencia

MIT
