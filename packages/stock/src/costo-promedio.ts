/**
 * Costo promedio ponderado (CPP) de un saldo de stock. PURA (sin DB, sin
 * framework): cada ingreso mezcla su cantidad y su costo unitario con el
 * saldo existente; cada egreso sale al costo promedio VIGENTE (no
 * FIFO/LIFO). Todo en `bigint` centavos + `Cantidad` (decimal string) —
 * nunca `number`, ni siquiera como paso intermedio, para no perder el
 * centavo en un promedio con muchos decimales (ej.: 3 u por $ 1.000 + 1 u
 * por $ 1 → promedio $ 250,25 y el egreso de las 4 vale exactamente
 * $ 1.001,00).
 */
import { multiplicar, sumarCantidades, type Cantidad } from "./cantidades.js";

export type SaldoStock = { cantidad: Cantidad; valor: bigint };

/**
 * Mezcla el saldo `s` con un `ingreso`: nueva cantidad = Σ cantidades,
 * nuevo valor = Σ valores, nuevo costo unitario = valor / cantidad
 * (redondeo comercial al centavo, una sola vez, al final).
 */
export function costoPromedio(s: SaldoStock, ingreso: { cantidad: Cantidad; costoUnitario: bigint }): SaldoStock & { costoUnitario: bigint } {
  const cantidad = sumarCantidades([s.cantidad, ingreso.cantidad]);
  const valorIngreso = multiplicar(ingreso.cantidad, ingreso.costoUnitario);
  const valor = s.valor + valorIngreso;
  return { cantidad, valor, costoUnitario: costoUnitarioDivision(valor, cantidad) };
}

/**
 * Repone `cantidad` con un valor total FIJO e historico. A diferencia de
 * `costoPromedio`, no reconstruye ese valor desde un costo unitario
 * redondeado: suma `valorFijo` exacto. Es la inversa contable de un egreso
 * ya valorizado, incluso cuando aquel egreso vacio el saldo y se llevo un
 * centavo residual que no puede representarse en el unitario.
 */
export function ingresoAValorFijo(s: SaldoStock, cantidadIngreso: Cantidad, valorFijo: bigint): SaldoStock & { costoUnitario: bigint } {
  const cantidad = sumarCantidades([s.cantidad, cantidadIngreso]);
  const valor = s.valor + valorFijo;
  return { cantidad, valor, costoUnitario: costoUnitarioDivision(valor, cantidad) };
}

/** `valor / cantidad` con redondeo comercial al centavo — cantidad como fracción exacta (`Cantidad` tiene hasta 4 decimales). Exportada para quien cierre un inventario (costo del ajuste "alta" de un sobrante). */
export function costoUnitarioDivision(valor: bigint, cantidad: Cantidad): bigint {
  const escala = 10_000n; // 4 decimales de `Cantidad`
  const negativo = cantidad.trim().startsWith("-");
  const sinSigno = negativo ? cantidad.trim().slice(1) : cantidad.trim();
  const [entero, decimal = ""] = sinSigno.split(".");
  const cantidadEscalada = BigInt(entero || "0") * escala + BigInt((decimal || "").padEnd(4, "0"));
  if (cantidadEscalada === 0n) return 0n;
  // costoUnitario = valor / (cantidadEscalada / escala) = (valor * escala) / cantidadEscalada, redondeo medio arriba.
  const numerador = valor * escala;
  const mitad = cantidadEscalada / 2n;
  const resultado = numerador >= 0n ? (numerador + mitad) / cantidadEscalada : -((-numerador + mitad) / cantidadEscalada);
  return negativo ? -resultado : resultado;
}

export type ResultadoEgreso = { ok: true; valorEgreso: bigint; resto: SaldoStock } | { ok: false; error: "stock_insuficiente"; disponible: Cantidad };

/**
 * Egresa `cantidad` del saldo `s` al costo promedio VIGENTE de `s`
 * (`s.valor / s.cantidad`, no se recalcula: el costo promedio ya está
 * fijado por el último `costoPromedio`). Si `cantidad` excede lo
 * disponible, `stock_insuficiente` con el disponible real.
 */
export function egresoAPromedio(s: SaldoStock, cantidad: Cantidad): ResultadoEgreso {
  const disponible = compararCantidad(cantidad, s.cantidad);
  if (disponible > 0) return { ok: false, error: "stock_insuficiente", disponible: s.cantidad };

  // Egresar TODO el saldo con `cantidad × costoUnitario` (redondeado al centavo) no da
  // necesariamente `s.valor` exacto — el redondeo puede dejar el resto en cantidad "0" con valor
  // residual (plata que no existe). Cuando se vacía el saldo entero, el egreso se lleva `s.valor`
  // EXACTO (sin redondear de nuevo) y el resto queda en cantidad y valor "0" limpios.
  if (disponible === 0) {
    return { ok: true, valorEgreso: s.valor, resto: { cantidad: "0.0000", valor: 0n } };
  }

  const costoUnitario = costoUnitarioDivision(s.valor, s.cantidad);
  const valorEgreso = multiplicar(cantidad, costoUnitario);
  const cantidadRestante = restarCantidad(s.cantidad, cantidad);
  const valorRestante = s.valor - valorEgreso;
  return { ok: true, valorEgreso, resto: { cantidad: cantidadRestante, valor: valorRestante } };
}

/**
 * Egresa `cantidad` del saldo `s` a un valor FIJO (no el promedio vigente
 * de `s`) — útil cuando una reversión tiene que volver al costo ORIGINAL
 * de una operación anterior (ej.: anular una recepción al precio pactado
 * en la orden de compra), no al costo promedio vigente del almacén (que
 * ya pudo cambiar por ingresos posteriores a otro precio). Mismo chequeo
 * de disponibilidad que `egresoAPromedio`; el valor egresado se acota a
 * `s.valor` (nunca deja el saldo con valor negativo si el fijo pedido es
 * mayor a lo que efectivamente queda, mismo criterio "sin plata fantasma"
 * del vaciado exacto de arriba).
 */
export function egresoAValorFijo(s: SaldoStock, cantidad: Cantidad, valorFijo: bigint): ResultadoEgreso {
  const disponible = compararCantidad(cantidad, s.cantidad);
  if (disponible > 0) return { ok: false, error: "stock_insuficiente", disponible: s.cantidad };
  const cantidadRestante = restarCantidad(s.cantidad, cantidad);
  const valorEgreso = valorFijo > s.valor ? s.valor : valorFijo;
  const valorRestante = s.valor - valorEgreso;
  return { ok: true, valorEgreso, resto: { cantidad: cantidadRestante, valor: valorRestante } };
}

/** `a - b` de dos `Cantidad`, reusando `sumarCantidades` (que ya escala a 4 decimales) con el segundo operando negado. */
export function restarCantidad(a: Cantidad, b: Cantidad): Cantidad {
  const bTrim = b.trim();
  const negado = bTrim.startsWith("-") ? bTrim.slice(1) : `-${bTrim}`;
  return sumarCantidades([a, negado]);
}

/** `a - b`, con signo (positivo si `a > b`) — para comparar sin pasar por `number`. */
export function compararCantidad(a: Cantidad, b: Cantidad): number {
  const diferencia = restarCantidad(a, b);
  if (/^-?0(\.0+)?$/.test(diferencia)) return 0;
  return diferencia.startsWith("-") ? -1 : 1;
}
