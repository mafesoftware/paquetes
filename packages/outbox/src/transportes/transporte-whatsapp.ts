import { ErrorOutbox } from "../errores.js";
import type { MensajeParaEnviar, Transporte } from "../transporte.js";

/** El resultado de mandar una plantilla de WhatsApp — misma forma que `Resultado` de `@mafesoftware/kapso-wa`, sin importar ese paquete (ver el JSDoc de `ResultadoEnvioCorreo` en `transporte-correo.ts`: el mismo motivo). */
export type ResultadoEnvioWhatsApp = { ok: true; id: string } | { ok: false; categoria: string; error: string };

/** Opciones de `transporteWhatsApp`. */
export interface OpcionesTransporteWhatsApp {
  /**
   * Las credenciales de WhatsApp del TENANT dueño del mensaje — cada
   * tenant/desarrollador tiene su propio número (`apiKey` + `phoneNumberId`
   * de `@mafesoftware/kapso-wa`, típicamente). Devolver `null`/`undefined`
   * (tenant sin WhatsApp configurado todavía) da `categoria: "credenciales"`
   * (permanente) sin intentar el envío.
   */
  credencialesDe: (tenantId: string) => unknown;
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
   */
  enviar: (credenciales: unknown, destino: string, plantilla: string, parametros: unknown[]) => Promise<ResultadoEnvioWhatsApp>;
  /**
   * Arma los parámetros posicionales de la plantilla (`{{1}}`, `{{2}}`...)
   * a partir de `datos`. Por defecto: `datos` tal cual si ya es un arreglo,
   * o `[]` si no — para una plantilla con exactamente un parámetro no
   * posicional, pasá tu propio `parametrosDe: (m) => [String((m.datos as { x: string }).x)]`.
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
 * llama en cada envío. Sin credenciales para ese tenant, el resultado es
 * `{ ok: false, categoria: "credenciales", codigo: "sin_credenciales" }`
 * ANTES de llamar a `enviar` — `procesarOutbox` lo marca `"descartado"` (es
 * `"credenciales"`, permanente): reintentar sin que nadie cargue el número
 * del tenant da el mismo resultado para siempre.
 *
 * **No tiene try/catch propio alrededor de `enviar`**, mismo motivo que
 * `transporteCorreo`: `procesarOutbox` ya atrapa cualquier excepción de
 * cualquier `Transporte` como `"transitorio"`.
 *
 * **Valida las opciones al construirlo** (`credencialesDe`/`enviar` tienen
 * que ser funciones) y tira `ErrorOutbox("opciones_invalidas")` si no.
 *
 * ```ts
 * import { transporteWhatsApp } from "@mafesoftware/outbox";
 * import { enviarPlantilla, type Credenciales } from "@mafesoftware/kapso-wa";
 *
 * const whatsapp = transporteWhatsApp({
 *   credencialesDe: (tenantId) => buscarCredencialesDelTenant(tenantId), // undefined si no configuró WhatsApp
 *   enviar: (cred, destino, plantilla, parametros) =>
 *     enviarPlantilla(cred as Credenciales, destino, plantilla, parametros as string[]),
 *   parametrosDe: (mensaje) => [(mensaje.datos as { turno: string }).turno],
 * });
 *
 * const resultado = await whatsapp({ id, tenantId, canal: "whatsapp", destino: "5491122334455", plantilla: "gf_turno_manana", datos: { turno: "10:00" } });
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
    const credenciales = credencialesDe(mensaje.tenantId);
    if (!credenciales) {
      return { ok: false, categoria: "credenciales", codigo: "sin_credenciales" };
    }

    const resultado = await enviar(credenciales, mensaje.destino, mensaje.plantilla, parametrosDe(mensaje));
    if (resultado.ok) return { ok: true, idExterno: resultado.id };
    return { ok: false, categoria: resultado.categoria, codigo: resultado.categoria };
  };
}
