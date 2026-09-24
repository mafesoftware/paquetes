# @mafesoftware/correo

Envío de mails transaccionales por [Resend](https://resend.com) para los
productos de MAFE Software (store360, consult360, …). Sin dependencias, sin
framework: `fetch` inyectable para los tests y **resultados en vez de
excepciones** — un mail es un aviso, y mandarlo no puede tumbar la operación
que lo dispara.

```ts
import { enviarCorreo, plantillaCorreo, botonCorreo, escapeHtml } from "@mafesoftware/correo";

const r = await enviarCorreo({
  apiKey: process.env.RESEND_API_KEY!,
  de: "Bestie K-Beauty <no-reply-bestie@store360.com.ar>",
  para: "clienta@gmail.com",
  asunto: "¡Gracias por tu compra!",
  html: plantillaCorreo({
    marca: { nombre: "Bestie K-Beauty", colorFondo: "#5c1f30" },
    cuerpoHtml: `<h1>Pedido W-0012</h1>${botonCorreo("https://bestie.com.ar/cuenta", "Ver mi pedido", "#5c1f30")}`,
  }),
});

if (!r.ok) console.error(r.categoria, r.error);
```

## API

- **`enviarCorreo(opciones)`** — POST a la API de Resend. Nunca tira: devuelve
  `{ ok: true, id }` o `{ ok: false, categoria, error }`. La categoría dice si
  reintentar sirve: `red` y `limite` sí; `credenciales` y `rechazado` no.
  Soporta varios destinatarios, `responderA` (reply-to) y adjuntos (los bytes
  se codifican a base64 acá). Ejemplo arriba.
- **`plantillaCorreo({ marca, cuerpoHtml, pie })`** — la cáscara HTML con la
  marca del producto: encabezado con color propio, ancho fijo, estilos en
  línea (los clientes de correo ignoran `<style>`). El `cuerpoHtml` lo arma la
  aplicación; la marca y el pie se escapan acá. Ejemplo arriba.
- **`botonCorreo(url, texto, color?)`** — un `<a>` con estilo de botón, listo
  para meter dentro de un `cuerpoHtml`:

  ```ts
  botonCorreo("https://bestie.com.ar/cuenta", "Ver mi pedido", "#5c1f30");
  // '<p style="..."><a href="https://bestie.com.ar/cuenta" style="...">Ver mi pedido</a></p>'
  ```

- **`escapeHtml(texto)`** — escapa `&`, `<`, `>`, `"` y `'` antes de interpolar
  texto de usuario en HTML:

  ```ts
  escapeHtml('<b>hola</b> & "chau"'); // '&lt;b&gt;hola&lt;/b&gt; &amp; &quot;chau&quot;'
  ```

## Reglas

- Todo texto que venga de un usuario pasa por `escapeHtml` antes de entrar al
  cuerpo. La plantilla escapa lo suyo (marca, pie); del `cuerpoHtml` es
  responsable quien lo arma.
- El remitente tiene que ser de un dominio verificado en Resend.
- En los tests, inyectá `fetch`: la suite no tiene por qué hablar con Resend.
