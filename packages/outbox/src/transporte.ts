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
  /**
   * `${tenantId}:${claveIdempotencia}` de la fila — globalmente único (la
   * columna `clave_idempotencia` sola solo es única DENTRO de un tenant).
   * Pensado para pasarlo al PROVEEDOR como su propia clave de idempotencia
   * (ej. el header `Idempotency-Key` de Resend, vía `transporteCorreo` →
   * `@mafesoftware/correo`) — la ÚNICA defensa real contra un envío
   * duplicado del MISMO intento de negocio. Ver "Entrega al menos una vez"
   * en el JSDoc de `procesarOutbox`: `SKIP LOCKED` evita que DOS workers
   * reclamen la MISMA fila a la vez, pero no evita que un worker mande el
   * mensaje, se caiga ANTES de registrar el resultado, y que el próximo
   * reclamo (tras el lease vencido) lo mande de nuevo — ahí la única red
   * real es que el PROVEEDOR reconozca la misma clave y no duplique.
   */
  claveIdempotencia: string;
}

/** Lo que le llega a un `Transporte` además del mensaje — hoy, la señal de cancelación del timeout de `procesarOutbox`. */
export interface ContextoTransporte {
  /**
   * Se aborta cuando `procesarOutbox` decide que este intento ya tardó más
   * que `timeoutMs` — un `Transporte` que hace una llamada de red puede
   * (no es obligatorio) pasarla como `signal` de su propio `fetch`/cliente
   * HTTP para cortar la conexión de verdad, no solo dejar de esperarla.
   * `procesarOutbox` YA trata el timeout como `"transitorio"` (`codigo:
   * "timeout"`) exista o no esa cooperación — la señal es una optimización
   * (libera la conexión antes), no lo que hace que el timeout funcione.
   */
  señal: AbortSignal;
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
 * **`categoria`/`codigo` nunca pueden traer datos personales (PII).** Los
 * dos se guardan tal cual en `ultimo_error_categoria`/`ultimo_error_codigo`
 * (columnas `text` sin cifrar, pensadas para loguearse y mostrarse en un
 * panel de admin) — nunca el destinatario, nunca el cuerpo del mensaje,
 * nunca el mensaje de error crudo del proveedor (que puede hacer eco de
 * cualquiera de los dos). `procesarOutbox` además recorta `codigo` a 64
 * caracteres antes de guardarlo, como salvaguarda — no como lugar donde
 * "esconder" texto libre.
 *
 * `transporteCorreo`/`transporteWhatsApp` (`@mafesoftware/outbox`) son las
 * implementaciones de referencia, sobre `@mafesoftware/correo` y
 * `@mafesoftware/kapso-wa` respectivamente — pero cualquier función con
 * esta forma sirve (un tercer canal, un mock de test).
 */
export type Transporte = (mensaje: MensajeParaEnviar, contexto: ContextoTransporte) => Promise<ResultadoTransporte>;
