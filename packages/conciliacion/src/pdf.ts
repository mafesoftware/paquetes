/**
 * Extracción de texto de `.pdf` con `pdfjs-dist`. Import DINÁMICO del
 * build `legacy` (ESM puro, sin worker de browser) — un paquete pesado que
 * no hace falta cargar si el banco no manda PDF.
 *
 * Errores traducidos a español, sin re-tirar el objeto crudo de `pdfjs`
 * (mensajes que después ve un usuario de conciliación, no un desarrollador):
 * - sin `contrasena` y el PDF la pide -> "el PDF está protegido"
 * - `contrasena` incorrecta -> "contraseña incorrecta"
 */

export type OpcionesExtraerPdf = { contrasena?: string };

/**
 * Devuelve las líneas de texto de cada página (`string[][]`, una entrada
 * por página). Reconstruye líneas con `item.hasEOL` de `pdfjs` (los
 * `TextItem` de una misma línea no traen salto de línea propio: hay que
 * juntarlos hasta el `hasEOL` para no perder el layout tabular del
 * extracto).
 */
export async function extraerLineasPdf(archivo: Uint8Array, opciones: OpcionesExtraerPdf = {}): Promise<string[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const tarea = pdfjs.getDocument({
    data: archivo,
    password: opciones.contrasena,
    useWorkerFetch: false,
  });

  let documento;
  try {
    documento = await tarea.promise;
  } catch (error) {
    if (error instanceof pdfjs.PasswordException) {
      if (error.code === pdfjs.PasswordResponses.NEED_PASSWORD) {
        throw new Error("el PDF está protegido");
      }
      throw new Error("contraseña incorrecta");
    }
    throw error;
  }

  const paginas: string[][] = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const pagina = await documento.getPage(i);
    const contenido = await pagina.getTextContent();
    const lineas: string[] = [];
    let actual = "";
    for (const item of contenido.items) {
      if (!("str" in item)) continue;
      actual += (actual && item.str ? " " : "") + item.str;
      if (item.hasEOL) {
        lineas.push(actual.replace(/\s+/g, " ").trim());
        actual = "";
      }
    }
    if (actual.trim() !== "") lineas.push(actual.replace(/\s+/g, " ").trim());
    paginas.push(lineas.filter((l) => l !== ""));
  }
  return paginas;
}
