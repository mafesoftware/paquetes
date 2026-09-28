/**
 * El `fetch` que se inyecta en cada lector de fuentes: la firma real de
 * `globalThis.fetch` (mismo patrón que `@mafesoftware/mercadopago-ar`), para
 * que un test pase un mock sin cast raro y una app pase el `fetch` real (o
 * uno instrumentado) sin fricción.
 */
export type Fetch = typeof globalThis.fetch;

/**
 * Por qué falló la lectura de una fuente pública. Nunca se tira: todo lector
 * de `/fuentes` devuelve `ResultadoFuente`, categorizado, para que quien
 * llama decida si reintentar (spec 02 §2: "si la fuente falla, alerta en el
 * panel de plataforma y el usuario puede cargar a mano").
 */
export type CategoriaErrorFuente =
  /** No se pudo llegar a la fuente: DNS, corte, timeout, `fetch` que tira. */
  | "red"
  /** La fuente contestó, pero con un status HTTP que no es 2xx. */
  | "http"
  /** La fuente contestó 2xx, pero el cuerpo no es JSON o no tiene la forma esperada. */
  | "formato";

/** El resultado uniforme de cualquier lector de `/fuentes`: nunca tira. */
export type ResultadoFuente<T> = { ok: true; valores: T } | { ok: false; categoria: CategoriaErrorFuente };
