/**
 * Texto apto para las fuentes estándar de PDF (Helvetica, Times, Courier de
 * `pdf-lib`), que codifican en WinAnsi: Latin-1 (tildes, ñ, ü, ¿, ¡, º)
 * más rayas, comillas tipográficas, viñeta, puntos suspensivos y €. Un solo
 * carácter fuera de eso (un emoji, una comilla rara pegada desde WhatsApp,
 * una letra con diacrítico que no es Latin-1) hace fallar TODO el PDF con
 * `WinAnsi cannot encode`.
 *
 * Lo codificable queda tal cual; lo demás se simplifica (se le quita el
 * diacrítico: `"ő"` → `"o"`) o, si ni así, se reemplaza por un espacio.
 */
const WIN_ANSI_EXTRA = new Set("—–‘’“”•…€");

function codificable(caracter: string): boolean {
  const codigo = caracter.codePointAt(0) ?? 0;
  return (codigo >= 0x20 && codigo <= 0x7e) || (codigo >= 0xa0 && codigo <= 0xff) || WIN_ANSI_EXTRA.has(caracter);
}

export function textoWinAnsi(valor: string): string {
  return Array.from(valor, (caracter) => {
    if (codificable(caracter)) return caracter;
    const simple = caracter.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return Array.from(simple).every(codificable) ? simple : " ";
  }).join("");
}
