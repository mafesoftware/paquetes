import { ErrorOutbox } from "../errores.js";
import type { MensajeParaEnviar, Transporte } from "../transporte.js";

/**
 * Lo que arma `render` a partir de `plantilla`/`datos` del mensaje: el
 * cuerpo real del mail. Al menos uno de `html`/`texto` tiene que venir con
 * contenido — `@mafesoftware/correo` rechaza (`categoria: "rechazado"`) un
 * mail sin ninguno de los dos.
 */
export interface CorreoRenderizado {
  asunto: string;
  html?: string;
  texto?: string;
}

/**
 * El resultado de mandar un correo — misma FORMA que `ResultadoCorreo` de
 * `@mafesoftware/correo` (`{ ok: true; id } | { ok: false; categoria; error
 * }`), sin importar ese paquete: pasarle la `enviarCorreo` real (con
 * `apiKey` ya aplicada) a `enviar` alcanza, porque `ResultadoCorreo` es
 * estructuralmente compatible con este tipo (`categoria` ahí es una unión
 * literal, que es un `string`).
 */
export type ResultadoEnvioCorreo = { ok: true; id: string } | { ok: false; categoria: string; error: string };

/** Opciones de `transporteCorreo`. */
export interface OpcionesTransporteCorreo {
  /**
   * La función que de verdad manda — normalmente `enviarCorreo` de
   * `@mafesoftware/correo`, aplicada parcialmente con la `apiKey` de la app
   * (`(o) => enviarCorreo({ ...o, apiKey })`, o directo si tu app maneja un
   * solo remitente). Inyectada para que los tests no salgan a Resend, y
   * para que este paquete no dependa de `@mafesoftware/correo` en tiempo de
   * ejecución (ni siquiera de sus tipos — ver `ResultadoEnvioCorreo`).
   * `claveIdempotencia` (el `${tenantId}:${claveIdempotencia}` de la fila,
   * ver `MensajeParaEnviar`) viaja en las opciones que recibe `enviar` —
   * `@mafesoftware/correo` (desde su changeset de idempotencia) la manda
   * como header `Idempotency-Key` a Resend si se la pasás: `(o) =>
   * enviarCorreo({ ...o, apiKey })` ya la reenvía sola, porque `o` (lo que
   * arma este `Transporte`) ya la incluye.
   */
  enviar: (opciones: {
    para: string;
    asunto: string;
    html?: string;
    texto?: string;
    de: string;
    claveIdempotencia: string;
    /** La `señal` del `contexto` que le llegó a este `Transporte` (ver `ContextoTransporte`) — reenviada tal cual, para que `(o) => enviarCorreo({ ...o, apiKey })` la pase sola al `fetch` de Resend. */
    señal: AbortSignal;
  }) => Promise<ResultadoEnvioCorreo>;
  /** El remitente (`"de"`) de cada envío — un mail transaccional de una app suele tener uno solo, no uno por tenant. */
  remitente: string;
  /** Arma `{ asunto, html?, texto? }` a partir de `plantilla`+`datos` del mensaje encolado. */
  render: (mensaje: Pick<MensajeParaEnviar, "plantilla" | "datos">) => CorreoRenderizado;
}

/**
 * Adapta `@mafesoftware/correo` a la forma `Transporte` que necesita
 * `procesarOutbox({ transportes: { correo } })`.
 *
 * **`render` SÍ tiene su propio try/catch, `enviar` NO.** Si `render` tira
 * (una plantilla desconocida, un dato faltante en `mensaje.datos`), el
 * problema es del MENSAJE en sí — reintentarlo da el mismo resultado
 * siempre — así que se clasifica `{ ok: false, categoria: "plantilla",
 * codigo: "render" }` (PERMANENTE, `procesarOutbox` lo descarta sin gastar
 * reintentos). Si en cambio `enviar` tira, el problema suele ser de RED o
 * del proveedor — `procesarOutbox` ya atrapa cualquier excepción de
 * CUALQUIER `Transporte` y la trata como `"transitorio"` (ver su JSDoc), así
 * que no hace falta duplicar ese try/catch acá para `enviar`.
 *
 * **Valida las opciones al construirlo** (que `enviar`/`render` sean
 * funciones, que `remitente` no esté vacío) y tira
 * `ErrorOutbox("opciones_invalidas")` si no — un error de PROGRAMACIÓN
 * (configurar mal el cron), no algo que dependa de un mensaje puntual.
 *
 * **`contexto.señal` se reenvía tal cual** a `enviar` (como `opciones.señal`)
 * — `(o) => enviarCorreo({ ...o, apiKey })` ya la pasa sola al `fetch` de
 * Resend (`@mafesoftware/correo` la soporta desde su changeset de
 * idempotencia/señal). Abortarla corta el PEDIDO de este lado, pero **no
 * deshace un envío que Resend ya haya aceptado** — si `procesarOutbox` la
 * aborta por `timeoutMs`, el mail puede salir igual, y el próximo intento
 * (con la MISMA `claveIdempotencia`) es lo único que evita que le llegue
 * dos veces al destinatario — parte de "entrega al menos una vez", ver el
 * JSDoc de `procesarOutbox`.
 *
 * ```ts
 * import { transporteCorreo } from "@mafesoftware/outbox";
 * import { enviarCorreo } from "@mafesoftware/correo";
 *
 * const correo = transporteCorreo({
 *   remitente: "Mi Club <no-reply@miclub.com.ar>",
 *   enviar: (o) => enviarCorreo({ ...o, apiKey: apiKeyDeResend }), // apiKeyDeResend: leída de la config de la app, no de este paquete; "señal" ya viaja en "o"
 *   render: (mensaje) => {
 *     if (mensaje.plantilla === "bienvenida") {
 *       const { nombre } = mensaje.datos as { nombre: string };
 *       return { asunto: `Hola, ${nombre}!`, html: `<p>Bienvenido, ${nombre}.</p>` };
 *     }
 *     throw new Error(`plantilla desconocida: ${mensaje.plantilla}`); // -> { ok: false, categoria: "plantilla", codigo: "render" }, descartado sin reintentar
 *   },
 * });
 *
 * const resultado = await correo(
 *   { id, tenantId, canal: "correo", destino: "socio@mail.com", plantilla: "bienvenida", datos: { nombre: "Ana" }, claveIdempotencia: `${tenantId}:bienvenida-${id}` },
 *   { señal: new AbortController().signal },
 * );
 * ```
 */
export function transporteCorreo(opciones: OpcionesTransporteCorreo): Transporte {
  if (typeof opciones.enviar !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'transporteCorreo: "enviar" tiene que ser una función.');
  }
  if (typeof opciones.render !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'transporteCorreo: "render" tiene que ser una función.');
  }
  if (typeof opciones.remitente !== "string" || !opciones.remitente.trim()) {
    throw new ErrorOutbox("opciones_invalidas", 'transporteCorreo: "remitente" no puede estar vacío.');
  }

  const { enviar, remitente, render } = opciones;

  return async (mensaje, contexto) => {
    let renderizado: CorreoRenderizado;
    try {
      renderizado = render(mensaje);
    } catch {
      // Ver el JSDoc de arriba: un mensaje que no se puede renderizar no se
      // arregla reintentando — permanente, no transitorio.
      return { ok: false, categoria: "plantilla", codigo: "render" };
    }

    const resultado = await enviar({
      para: mensaje.destino,
      asunto: renderizado.asunto,
      html: renderizado.html,
      texto: renderizado.texto,
      de: remitente,
      claveIdempotencia: mensaje.claveIdempotencia,
      señal: contexto.señal,
    });

    if (resultado.ok) return { ok: true, idExterno: resultado.id };
    return { ok: false, categoria: resultado.categoria, codigo: resultado.categoria };
  };
}
