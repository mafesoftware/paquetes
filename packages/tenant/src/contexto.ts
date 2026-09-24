import { AsyncLocalStorage } from "node:async_hooks";

/**
 * El tenant forzado a mano para lo que dura un callback — pensado para
 * callbacks que no corren dentro de una request normal (un webhook que
 * llega al dominio de la plataforma y dice de qué organización es en un
 * parámetro ya validado, un cron, un script de seed) y necesitan que el
 * código de dominio que llaman por debajo pueda preguntar
 * `tenantDelContexto()` sin que haya que pasarle el id a mano por toda la
 * cadena de llamadas.
 *
 * `AsyncLocalStorage` en vez de una variable de módulo: el valor tiene que
 * quedar aislado por CADENA DE LLAMADAS ASYNC, no global — si dos requests
 * concurrentes llamaran `conTenant` con ids distintos y esto fuera una
 * variable común, una pisaría a la otra.
 */
const almacen = new AsyncLocalStorage<string>();

/**
 * Corre `fn` con `id` como el tenant del contexto para toda la cadena
 * async que dispare (incluye llamadas a otras funciones, no solo el cuerpo
 * directo de `fn`). Devuelve lo que devuelva `fn`.
 *
 * ```ts
 * await conTenant(tenantId, async () => {
 *   await procesarWebhook(payload); // adentro, tenantDelContexto() === tenantId
 * });
 * ```
 */
export function conTenant<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return almacen.run(id, fn);
}

/**
 * El tenant del contexto actual, o `null` fuera de un `conTenant` (por
 * ejemplo, en un test que no lo envolvió). Nunca tira: la ausencia de
 * contexto es una situación válida, no un error.
 */
export function tenantDelContexto(): string | null {
  return almacen.getStore() ?? null;
}
