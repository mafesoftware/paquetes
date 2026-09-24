import { ErrorOutbox } from "../errores.js";
import type { MensajeParaEnviar, Transporte } from "../transporte.js";

/** El resultado de mandar una plantilla de WhatsApp — misma forma que `Resultado` de `@mafesoftware/kapso-wa`, sin importar ese paquete (ver el JSDoc de `ResultadoEnvioCorreo` en `transporte-correo.ts`: el mismo motivo). */
export type ResultadoEnvioWhatsApp = { ok: true; id: string } | { ok: false; categoria: string; error: string };

/** Opciones de `transporteWhatsApp`. */
export interface OpcionesTransporteWhatsApp {
  /**
   * Las credenciales de WhatsApp del TENANT dueño del mensaje — cada
   * tenant/desarrollador tiene su propio número (`apiKey` + `phoneNumberId`
   * de `@mafesoftware/kapso-wa`, típicamente). Devolver (o resolver a)
   * `null`/`undefined` (tenant sin WhatsApp configurado todavía) da
   * `categoria: "credenciales"` (permanente) sin intentar el envío.
   *
   * **Puede ser async** (`Promise<unknown>`) — lo típico si busca las
   * credenciales en la base — y SIEMPRE se espera (`await`) antes de
   * usarla: pasarle una `Promise` sin resolver a `enviar` (el bug real que
   * tenía una versión anterior de este paquete) rompía cualquier
   * `Transporte` real, porque una `Promise` es un objeto TRUTHY — el
   * chequeo de "sin credenciales" nunca disparaba, y `enviar` recibía el
   * objeto `Promise` en vez de las credenciales de verdad. Si la función
   * (o la promesa que devuelve) RECHAZA, se trata como `"transitorio"`
   * (`categoria: "red"`, `codigo: "credenciales_excepcion"`) — a
   * diferencia de `enviar` (ver más abajo), una búsqueda de credenciales
   * suele ser una consulta a la base, y un fallo ahí es más plausible que
   * sea transitorio (una conexión que se cortó) que un problema del
   * mensaje en sí.
   */
  credencialesDe: (tenantId: string) => unknown | Promise<unknown>;
  /**
   * La función que de verdad manda — normalmente `enviarPlantilla` de
   * `@mafesoftware/kapso-wa`, adaptada a esta forma:
   * `(cred, destino, plantilla, parametros) => enviarPlantilla(cred as Credenciales, destino, plantilla, parametros)`.
   * Inyectada para que los tests no salgan a Kapso, y para que este
   * paquete no dependa de `@mafesoftware/kapso-wa` en tiempo de ejecución.
   * **Siempre manda una PLANTILLA, nunca texto libre**: afuera de la
   * ventana de 24 h de WhatsApp un texto libre da `ventana` (permanente,
   * ver `clasificarResultado`) — un mensaje encolado puede procesarse
   * minutos u horas después de que pasó el hecho que lo generó, así que no
   * hay forma de garantizar que siga dentro de la ventana.
   *
   * `claveIdempotencia` (`${tenantId}:${claveIdempotencia}` de la fila,
   * ver `MensajeParaEnviar`) se pasa como quinto argumento — **`kapso-wa`
   * hoy NO expone ningún mecanismo de idempotencia propio** (a diferencia
   * de `@mafesoftware/correo`, que reenvía esta misma clave como header
   * `Idempotency-Key` a Resend): un `enviar` que solo llame a
   * `enviarPlantilla` la recibe y no hace nada con ella. Documentado acá
   * porque es una limitación real: un envío de WhatsApp reintentado tras
   * un crash a mitad de camino (ver "Entrega al menos una vez" en el JSDoc
   * de `procesarOutbox`) puede llegarle DOS VECES al destinatario sin que
   * este paquete (ni Kapso) puedan evitarlo hoy. Si tu integración de
   * WhatsApp sí soporta una clave de idempotencia propia, pasala desde acá.
   */
  enviar: (credenciales: unknown, destino: string, plantilla: string, parametros: unknown[], claveIdempotencia: string) => Promise<ResultadoEnvioWhatsApp>;
  /**
   * Arma los parámetros posicionales de la plantilla (`{{1}}`, `{{2}}`...)
   * a partir de `datos`. Por defecto: `datos` tal cual si ya es un arreglo,
   * o `[]` si no — para una plantilla con exactamente un parámetro no
   * posicional, pasá tu propio `parametrosDe: (m) => [String((m.datos as { x: string }).x)]`.
   * Si tira (una plantilla que espera datos que `mensaje.datos` no tiene),
   * se clasifica `{ ok: false, categoria: "plantilla", codigo: "render" }`
   * (PERMANENTE: el mismo mensaje mal armado no se arregla reintentando).
   */
  parametrosDe?: (mensaje: Pick<MensajeParaEnviar, "plantilla" | "datos">) => unknown[];
}

function parametrosPorDefecto(mensaje: Pick<MensajeParaEnviar, "plantilla" | "datos">): unknown[] {
  return Array.isArray(mensaje.datos) ? mensaje.datos : [];
}

/**
 * Adapta `@mafesoftware/kapso-wa` a la forma `Transporte` que necesita
 * `procesarOutbox({ transportes: { whatsapp } })`.
 *
 * **Credenciales por tenant, no una API key fija de la app**: a diferencia
 * de `transporteCorreo` (un remitente por app), WhatsApp requiere el número
 * de CADA tenant/club/consultorio — `credencialesDe(mensaje.tenantId)` se
 * llama (y se espera, sea o no async — ver su JSDoc) en cada envío. Sin
 * credenciales para ese tenant, el resultado es `{ ok: false, categoria:
 * "credenciales", codigo: "sin_credenciales" }` ANTES de llamar a `enviar`
 * — `procesarOutbox` lo marca `"descartado"` (es `"credenciales"`,
 * permanente): reintentar sin que nadie cargue el número del tenant da el
 * mismo resultado para siempre. Si `credencialesDe` RECHAZA, se trata como
 * `"transitorio"` (`codigo: "credenciales_excepcion"`) — ver su JSDoc.
 *
 * **`parametrosDe` SÍ tiene su propio try/catch, `enviar` NO** — mismo
 * motivo (y misma categoría, `"plantilla"`/`"render"`) que `render` en
 * `transporteCorreo`: un problema de ARMAR el mensaje es permanente: el
 * mismo mensaje mal armado no se arregla reintentando. Un fallo de
 * `enviar` en cambio lo atrapa `procesarOutbox` como `"transitorio"` (ver
 * su JSDoc), no hace falta duplicarlo acá.
 *
 * **Valida las opciones al construirlo** (`credencialesDe`/`enviar` tienen
 * que ser funciones) y tira `ErrorOutbox("opciones_invalidas")` si no.
 *
 * ```ts
 * import { transporteWhatsApp } from "@mafesoftware/outbox";
 * import { enviarPlantilla, type Credenciales } from "@mafesoftware/kapso-wa";
 *
 * const whatsapp = transporteWhatsApp({
 *   credencialesDe: (tenantId) => buscarCredencialesDelTenant(tenantId), // async: undefined si no configuró WhatsApp
 *   enviar: (cred, destino, plantilla, parametros) =>
 *     enviarPlantilla(cred as Credenciales, destino, plantilla, parametros as string[]),
 *   parametrosDe: (mensaje) => [(mensaje.datos as { turno: string }).turno],
 * });
 *
 * const resultado = await whatsapp(
 *   { id, tenantId, canal: "whatsapp", destino: "5491122334455", plantilla: "gf_turno_manana", datos: { turno: "10:00" }, claveIdempotencia: `${tenantId}:turno-${id}` },
 *   { señal: new AbortController().signal },
 * );
 * ```
 */
export function transporteWhatsApp(opciones: OpcionesTransporteWhatsApp): Transporte {
  if (typeof opciones.credencialesDe !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'transporteWhatsApp: "credencialesDe" tiene que ser una función.');
  }
  if (typeof opciones.enviar !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'transporteWhatsApp: "enviar" tiene que ser una función.');
  }
  if (opciones.parametrosDe !== undefined && typeof opciones.parametrosDe !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'transporteWhatsApp: "parametrosDe" (si se pasa) tiene que ser una función.');
  }

  const { credencialesDe, enviar } = opciones;
  const parametrosDe = opciones.parametrosDe ?? parametrosPorDefecto;

  return async (mensaje) => {
    let credenciales: unknown;
    try {
      // `await` sobre un valor NO-Promise lo deja pasar tal cual (no hace
      // falta distinguir el caso sync del async) — lo que importa es que
      // ACÁ siempre queda resuelto, nunca una Promise sin resolver viajando
      // como si fueran las credenciales (ver el JSDoc de `credencialesDe`).
      credenciales = await credencialesDe(mensaje.tenantId);
    } catch {
      return { ok: false, categoria: "red", codigo: "credenciales_excepcion" };
    }
    if (!credenciales) {
      return { ok: false, categoria: "credenciales", codigo: "sin_credenciales" };
    }

    let parametros: unknown[];
    try {
      parametros = parametrosDe(mensaje);
    } catch {
      return { ok: false, categoria: "plantilla", codigo: "render" };
    }

    const resultado = await enviar(credenciales, mensaje.destino, mensaje.plantilla, parametros, mensaje.claveIdempotencia);
    if (resultado.ok) return { ok: true, idExterno: resultado.id };
    return { ok: false, categoria: resultado.categoria, codigo: resultado.categoria };
  };
}
