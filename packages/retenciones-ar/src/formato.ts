/**
 * Helpers de formateo COMPARTIDOS por los exportadores fiscales de
 * retenciones/percepciones argentinas (SICORE, SIRE/F.2004, ARBA, AGIP):
 * ancho fijo, delimitado, fechas, CUIT e importes en centavos.
 *
 * **Ancho fijo (SICORE/SIRE)**: registros de texto plano, un campo pegado al
 * siguiente sin separador, longitud exacta según el diseño de cada
 * organismo. **Delimitado (ARBA/AGIP)**: fila `;` con decimal `,` (CUIT con
 * guiones, importe con coma), más legible a mano que un ancho fijo — mismo
 * criterio que el diseño real de esos dos organismos (no publican un layout
 * de columnas fijas como AFIP).
 *
 * El layout exacto campo a campo de cada archivo (qué columna va en qué
 * posición, con qué código de impuesto/concepto) es específico de cada app
 * — este módulo solo da los building blocks de formateo; quien arma la
 * línea completa (`anchoFijo`/`filaDelimitada` encadenados) es la app que
 * consume este paquete, contra datos ya resueltos (certificados, períodos,
 * filas practicadas) que este paquete no conoce.
 */

/** Ajusta `valor` a `ancho` caracteres exactos (corta si sobra, rellena si falta). */
export function anchoFijo(valor: string, ancho: number, opciones: { relleno?: string; alinear?: "izquierda" | "derecha" } = {}): string {
  const relleno = opciones.relleno ?? " ";
  const alinear = opciones.alinear ?? "izquierda";
  const texto = valor.length > ancho ? valor.slice(0, ancho) : valor;
  const faltan = ancho - texto.length;
  if (faltan <= 0) return texto;
  const pad = relleno.repeat(faltan);
  return alinear === "izquierda" ? texto + pad : pad + texto;
}

/** Numérico, alineado a la derecha, relleno de ceros (campos AFIP: fechas, números, importes). */
export function numeroFijo(valor: string, ancho: number): string {
  return anchoFijo(valor, ancho, { relleno: "0", alinear: "derecha" });
}

/** Solo dígitos (para CUIT/documentos: descarta guiones/puntos si vinieran). */
export function soloDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

/** CUIT sin guiones, 11 dígitos (el formato normalizado en el que una app típicamente guarda el CUIT de un sujeto retenido). */
export function cuitSinGuiones(cuit: string | null | undefined): string {
  return numeroFijo(soloDigitos(cuit), 11);
}

/** `"20304050607"` → `"20-30405060-7"` (brief ARBA/AGIP: "CUIT con guiones"). */
export function cuitConGuiones(cuit: string | null | undefined): string {
  const limpio = cuitSinGuiones(cuit);
  return `${limpio.slice(0, 2)}-${limpio.slice(2, 10)}-${limpio.slice(10)}`;
}

/** `"2026-09-15"` → `"20260915"` (AAAAMMDD, formato SICORE/SIRE). */
export function fechaCompacta(fecha: string): string {
  return fecha.replaceAll("-", "");
}

/** `"2026-09-15"` → `"15/09/2026"` (DD/MM/AAAA, formato ARBA/AGIP). */
export function fechaBarras(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${anio}`;
}

/**
 * Centavos → dígitos sin coma ni signo, ancho fijo con ceros a la
 * izquierda (diseño SICORE/SIRE: 2 últimos dígitos son los centavos
 * implícitos). Tira si el importe es negativo — "montos negativos
 * imposibles" (brief): un importe de retención/base nunca es negativo, así
 * que un negativo acá es un bug de quien llama, no un caso a representar.
 */
export function importeSinComaAncho(centavos: bigint, ancho: number): string {
  if (centavos < 0n) throw new Error(`importeSinComaAncho: importe negativo (${centavos}) — un importe fiscal exportado nunca es negativo.`);
  return numeroFijo(centavos.toString(), ancho);
}

/** Centavos → `"1234,56"` (decimal `,`, sin separador de miles). Tira ante un negativo, mismo criterio que `importeSinComaAncho`. */
export function importeConComa(centavos: bigint): string {
  if (centavos < 0n) throw new Error(`importeConComa: importe negativo (${centavos}) — un importe fiscal exportado nunca es negativo.`);
  const enteros = (centavos / 100n).toString();
  const dec = (centavos % 100n).toString().padStart(2, "0");
  return `${enteros},${dec}`;
}

/**
 * Porcentaje `"60"` → `"060,00"` (brief, ejemplo textual exacto): 3 dígitos
 * enteros + coma + 2 decimales, ancho total 6. `null`/ausente → `"000,00"`
 * (sin exclusión).
 */
export function porcentajeConComa(porcentaje: string | null | undefined): string {
  const numero = porcentaje ? Number(porcentaje) : 0;
  const entero = Math.trunc(numero).toString().padStart(3, "0");
  const dec = Math.round((numero - Math.trunc(numero)) * 100)
    .toString()
    .padStart(2, "0");
  return `${entero},${dec}`;
}

/** `"2,50"` → `"02,50"` (alícuota corta, ancho 5: 2 enteros + coma + 2 decimales) — usado por SIRE. */
export function alicuotaCorta(porcentaje: string): string {
  const numero = Number(porcentaje);
  const entero = Math.trunc(numero).toString().padStart(2, "0");
  const dec = Math.round((numero - Math.trunc(numero)) * 100)
    .toString()
    .padStart(2, "0");
  return `${entero},${dec}`;
}

/** Arma el contenido final: líneas unidas con CRLF + CRLF final (diseño de organismos, ver docs). */
export function armarContenido(lineas: readonly string[]): string {
  return lineas.map((l) => `${l}\r\n`).join("");
}

/** Fila delimitada `;` (ARBA/AGIP), cada celda ya formateada. */
export function filaDelimitada(celdas: readonly string[]): string {
  return celdas.join(";");
}

/** El contenido de texto codificado ISO-8859-1 (Latin-1) — lo que declaran SICORE/SIRE/ARBA/AGIP para sus archivos de importación. */
export function aBufferLatin1(contenido: string): Buffer {
  return Buffer.from(contenido, "latin1");
}
