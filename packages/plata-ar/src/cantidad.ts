/**
 * Cantidades físicas (unidades, kg, m³) guardadas como decimal EXACTO en
 * texto — lo que devuelve una columna `numeric` de Postgres: `"150.000"`.
 * Nunca pasan por `number`, así que no pierden decimales.
 *
 * El problema que resuelven: mostrar el texto crudo de la base confunde,
 * porque en Argentina `"150.000"` se lee como ciento cincuenta MIL. Y al
 * revés, lo que alguien tipea (`"1.500"`, `"2,5"`) hay que pasarlo a la
 * forma con punto decimal que espera la base.
 */

/**
 * Cantidad de la base → texto argentino, sin ceros de relleno: `"150.000"`
 * → `"150"`, `"2.500"` → `"2,5"`, `"1500"` → `"1.500"`.
 */
export function formatearCantidad(valor: string): string {
  const limpio = valor.trim();
  const negativo = limpio.startsWith("-");
  const [enteros = "0", decimales = ""] = (negativo ? limpio.slice(1) : limpio).split(".");
  const miles = (enteros.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraccion = decimales.replace(/0+$/, "");
  const resultado = fraccion ? `${miles},${fraccion}` : miles;
  return negativo && resultado !== "0" ? `-${resultado}` : resultado;
}

/**
 * Cantidad de la base → valor para precargar un `<input>`: coma decimal y
 * SIN separador de miles (`"1500"`, `"2,5"`), así lo que se ve es lo que
 * `normalizarCantidad` vuelve a leer igual.
 */
export function cantidadParaInput(valor: string): string {
  return formatearCantidad(valor).replace(/\./g, "");
}

/**
 * Lo que alguien tipeó → decimal con punto para la base. Convención
 * argentina: `"1.500"` es mil quinientos (punto seguido de grupos de 3) y
 * `"2,5"` es dos y medio. Un `"2.5"` (punto que no agrupa miles) se respeta
 * como decimal. No valida el resultado: eso lo hace el esquema de la app.
 */
export function normalizarCantidad(texto: string): string {
  const limpio = texto.trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpio)) return limpio.replace(/\./g, "").replace(",", ".");
  return limpio.replace(",", ".");
}
