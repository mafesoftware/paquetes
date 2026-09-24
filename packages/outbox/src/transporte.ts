import type { ResultadoTransporte } from "./clasificar-resultado.js";
import type { CanalOutbox } from "./tipos.js";

/**
 * Lo que un `Transporte` recibe para mandar un mensaje — un subconjunto de
 * las columnas de `tablaOutbox` (`@mafesoftware/outbox/drizzle`), en
 * camelCase. `procesarOutbox` arma esto a partir de cada fila que reclama;
 * `datos` es `unknown` porque su forma la define cada `plantilla` de cada
 * app (este paquete no la interpreta).
 */
export interface MensajeParaEnviar {
  id: string;
  tenantId: string;
  canal: CanalOutbox;
  destino: string;
  plantilla: string;
  datos: unknown;
}

/**
 * La función que de verdad manda un mensaje por un canal — inyectada en
 * `procesarOutbox({ transportes: { correo?, whatsapp? } })`, una por canal.
 * **Nunca tira, por contrato** — cualquier fallo vuelve como
 * `{ ok: false, categoria, codigo? }`, nunca como excepción — pero
 * `procesarOutbox` igual atrapa cualquier excepción que un `Transporte`
 * llegara a tirar (tratándola como `"transitorio"`, ver su JSDoc): un
 * `Transporte` que no respeta el contrato no puede dejar mensajes de OTRAS
 * filas del mismo lote sin procesar.
 *
 * `transporteCorreo`/`transporteWhatsApp` (`@mafesoftware/outbox`) son las
 * implementaciones de referencia, sobre `@mafesoftware/correo` y
 * `@mafesoftware/kapso-wa` respectivamente — pero cualquier función con
 * esta forma sirve (un tercer canal, un mock de test).
 */
export type Transporte = (mensaje: MensajeParaEnviar) => Promise<ResultadoTransporte>;
