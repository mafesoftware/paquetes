/**
 * `.csv` genérico para exportaciones de reportes: separador `;` (el que
 * abre directo en Excel/Sheets configurados en español, donde `,` es el
 * separador decimal), BOM UTF-8 opcional y anti-inyección de fórmulas.
 */

/**
 * Caracteres que, en la primera posición de una celda, un cliente de
 * planillas (Excel, Google Sheets, LibreOffice) interpreta como el inicio
 * de una fórmula. Es la inyección de fórmulas en CSV/Excel (CWE-1236 /
 * OWASP "CSV Injection"): un dato que en verdad vino de un USUARIO (razón
 * social, descripción, nombre de un proveedor...) y que arranca con
 * `=`/`+`/`-`/`@` se ejecuta como fórmula al abrir el archivo exportado en
 * la máquina de quien lo descarga — por ejemplo
 * `=HYPERLINK("http://evil","click")`, o una fórmula que exfiltra otras
 * celdas por red. Anteponer un apóstrofo (`'`) es el escape estándar que
 * usan estas mismas planillas para forzar texto literal: la celda se
 * muestra con el apóstrofo en Google Sheets/LibreOffice, y Excel lo oculta
 * (es su marcador nativo de "texto, no fórmula"). `\t`/`\r` se incluyen
 * porque algunos parsers también los tratan como inicio de fórmula si
 * preceden a uno de los anteriores tras trimear.
 */
const INICIOS_PELIGROSOS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** `true` si `texto` empieza con un carácter que una planilla leería como fórmula. */
function esPeligrosa(texto: string): boolean {
  return texto.length > 0 && INICIOS_PELIGROSOS.has(texto[0] as string);
}

/** Antepone un apóstrofo si `texto` puede interpretarse como fórmula. */
function neutralizarSiEsFormula(texto: string): string {
  return esPeligrosa(texto) ? `'${texto}` : texto;
}

/** Escapa una celda si contiene el separador, comillas o salto de línea (RFC 4180, con `;`). */
function envolverSiHaceFalta(texto: string): string {
  return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export type OpcionesCsv = {
  /**
   * Antepone el BOM UTF-8 (`﻿`) al contenido. Default `true`: sin él,
   * Excel (en Windows, el destino más común de un `.csv` bajado desde un
   * navegador) asume la codificación del sistema y rompe los acentos y la
   * `ñ` de cualquier texto en español — Google Sheets/LibreOffice lo
   * ignoran sin problema, así que agregarlo no rompe nada del otro lado.
   */
  bom?: boolean;
  /**
   * Neutraliza celdas de texto que empiecen con `=`/`+`/`-`/`@` (posible
   * fórmula) anteponiendo un apóstrofo. Default `true`: ningún dato tipeado
   * por un usuario (razón social, proveedor, detalle...) se exporta tal
   * cual si puede ejecutarse como fórmula en la máquina de quien abre el
   * archivo. Un valor NUMÉRICO nunca se toca (`String(numero)` no puede
   * empezar con esos caracteres salvo `-` de un negativo, que una planilla
   * no interpreta como fórmula por sí solo). Desactivarla es
   * responsabilidad de quien llama.
   */
  antiInyeccion?: boolean;
};

/** Arma un `.csv` a partir de encabezados + filas ya formateadas (texto plano, listo para mostrar). */
export function filasACsv(
  encabezados: readonly string[],
  filas: readonly (readonly (string | number)[])[],
  opciones: OpcionesCsv = {},
): string {
  const { bom = true, antiInyeccion = true } = opciones;

  const celda = (valor: string | number): string => {
    const texto = String(valor);
    // La neutralización SOLO se aplica a celdas que ya eran texto: un
    // `number` negativo también empieza con "-" al convertirlo a string
    // (`String(-5)` -> `"-5"`), y NO es una fórmula — aplicarla sin mirar
    // el tipo original le antepondría un apóstrofo a cualquier monto
    // negativo de la planilla.
    const protegida = antiInyeccion && typeof valor === "string" ? neutralizarSiEsFormula(texto) : texto;
    return envolverSiHaceFalta(protegida);
  };

  const lineas = [encabezados.map(celda).join(";")];
  for (const fila of filas) lineas.push(fila.map(celda).join(";"));
  const contenido = lineas.join("\n");
  return bom ? `﻿${contenido}` : contenido;
}
