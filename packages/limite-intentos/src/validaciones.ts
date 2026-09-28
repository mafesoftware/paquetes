import { ErrorLimiteIntentos } from "./errores.js";

/**
 * Exige que `valor` sea un entero finito `>= 1` — usado por `registrarIntento`
 * para validar `maximo`/`ventanaMs`/`bloqueoMs` ANTES de tocar la base (sin
 * ida y vuelta): un `Infinity`, un `NaN`, un decimal o un valor `<= 0` no
 * tienen sentido como tope de intentos, duración de ventana ni duración de
 * bloqueo, y dejarlos pasar produciría una consulta SQL con un parámetro sin
 * sentido en vez de un error claro en el momento del llamado.
 *
 * `nombreOpcion` viaja en el mensaje para que el error diga QUÉ opción vino
 * mal, sin tener que adivinarlo desde afuera.
 */
export function enteroPositivo(valor: number, nombreOpcion: string, funcion: string): number {
  if (!Number.isInteger(valor) || valor < 1) {
    throw new ErrorLimiteIntentos(
      "opciones_invalidas",
      `${funcion}: "${nombreOpcion}" tiene que ser un entero finito >= 1 (fue ${valor}).`,
    );
  }
  return valor;
}
