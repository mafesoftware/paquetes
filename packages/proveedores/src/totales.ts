/**
 * Totales de un documento de proveedor: Total = Σ ítems + IVA + percepciones,
 * con una validación que tolera diferencias de redondeo de hasta $1 (con un
 * ajuste explícito, nunca aplicado en silencio). Funciones PURAS: sin DB.
 */
import { redondearComercial } from "@mafesoftware/plata-ar";
import { calcularIva, type AlicuotaIva } from "./iva.js";

export type ItemParaTotal = { cantidad: string; precioUnitarioCentavos: bigint; alicuotaIva: AlicuotaIva };

/**
 * Una percepción de un documento (IVA, IIBB u otras). `centavos` en STRING a
 * propósito: así encaja tal cual con una fila leída de JSON o de una fila de
 * base de datos donde un `bigint` no es representable nativamente.
 */
export type PercepcionParaTotal = { tipo: "iva" | "iibb" | "otras"; centavos: string };

const FORMATO_CANTIDAD = /^\d+(\.\d{1,4})?$/;
const ESCALA_CANTIDAD = 10_000n;

function cantidadEscalada(cantidad: string): bigint {
  const texto = cantidad.trim();
  if (!FORMATO_CANTIDAD.test(texto)) {
    throw new Error(`cantidad inválida: "${cantidad}" (se espera un decimal positivo de hasta 4 decimales)`);
  }
  // `entero = "0"` tipa `string | undefined` para tsc aunque el regex de
  // arriba ya garantiza que hay al menos un dígito antes del punto (o
  // ningún punto).
  const [entero = "0", decimal = ""] = texto.split(".");
  return BigInt(entero) * ESCALA_CANTIDAD + BigInt(decimal.padEnd(4, "0"));
}

/** Subtotal de UN ítem: `cantidad × precioUnitario`, redondeo comercial al centavo. */
export function subtotalItem(cantidad: string, precioUnitarioCentavos: bigint): bigint {
  return redondearComercial(precioUnitarioCentavos * cantidadEscalada(cantidad), ESCALA_CANTIDAD);
}

export type TotalesDocumento = { subtotal: bigint; iva: bigint };

/** Σ subtotales + Σ IVA de todos los ítems. */
export function totalesDeItems(items: readonly ItemParaTotal[]): TotalesDocumento {
  let subtotal = 0n;
  let iva = 0n;
  for (const item of items) {
    const sub = subtotalItem(item.cantidad, item.precioUnitarioCentavos);
    subtotal += sub;
    iva += calcularIva(sub, item.alicuotaIva);
  }
  return { subtotal, iva };
}

/** Σ percepciones (cada `centavos` viene en STRING — ver `PercepcionParaTotal` — y se parsea acá con `BigInt`). */
export function totalPercepciones(percepciones: readonly PercepcionParaTotal[]): bigint {
  return percepciones.reduce((acc, p) => acc + BigInt(p.centavos), 0n);
}

const TOLERANCIA_CENTAVOS = 100n; // $1,00

export type ResultadoValidacionTotal = { ok: true; ajuste: bigint } | { ok: false; diferencia: bigint };

/**
 * Compara el total CALCULADO (ítems + IVA + percepciones + otros tributos)
 * contra el total INFORMADO en el documento. Si difieren hasta $1, devuelve
 * el ajuste a persistir EXPLÍCITAMENTE — nunca lo aplica en silencio, y
 * nunca tolera una diferencia mayor.
 */
export function validarTotalDocumento(calculado: bigint, informado: bigint): ResultadoValidacionTotal {
  const diferencia = informado - calculado;
  const abs = diferencia < 0n ? -diferencia : diferencia;
  if (abs > TOLERANCIA_CENTAVOS) return { ok: false, diferencia };
  return { ok: true, ajuste: diferencia };
}
