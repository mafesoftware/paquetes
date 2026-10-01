/**
 * Punto de entrada del parseo de extractos bancarios. Cada banco soportado
 * (`bancos/*.ts`) se registra acá con su(s) `ParserExtracto` (uno por
 * formato que ofrece) y un heurístico de `detectar`.
 */
import type { Moneda } from "@mafesoftware/plata-ar";
import type { MapeoColumnas } from "./mapeo.js";
import { parserGaliciaCsv, parserGaliciaPdf, detectarGalicia } from "./bancos/galicia.js";
import { parserSantanderCsv, detectarSantander } from "./bancos/santander.js";
import { parserBbvaXlsx, detectarBbva } from "./bancos/bbva.js";
import { parserMacroCsv, detectarMacro } from "./bancos/macro.js";
import { parserNacionCsv, detectarNacion } from "./bancos/nacion.js";
import { parserProvinciaCsv, detectarProvincia } from "./bancos/provincia.js";

export type { MapeoColumnas } from "./mapeo.js";

export type LineaExtracto = {
  id: string;
  fecha: string; // ISO YYYY-MM-DD
  descripcion: string;
  importe: bigint; // centavos, CON signo
  saldo: bigint | null; // centavos
  referencia: string | null;
};

export type Advertencia = { linea: number; mensaje: string };

/** `{cuenta, moneda, lineas}` + `advertencias` opcional (saldo corrido inconsistente). */
export type ExtractoCuenta = {
  cuenta: string;
  moneda: Moneda;
  lineas: Omit<LineaExtracto, "id">[];
  advertencias?: Advertencia[];
};

export type FormatoExtracto = "csv" | "xlsx" | "pdf";

export interface ParserExtracto {
  banco: string;
  formato: FormatoExtracto;
  parsear(archivo: Uint8Array, opciones?: { contrasena?: string; mapeo?: MapeoColumnas }): Promise<ExtractoCuenta[]>;
}

type EntradaBanco = {
  nombre: string;
  etiqueta: string;
  parsers: ParserExtracto[];
  detectar: (archivo: Uint8Array, nombreArchivo: string) => boolean;
};

const BANCOS: EntradaBanco[] = [
  { nombre: "galicia", etiqueta: "Banco Galicia", parsers: [parserGaliciaCsv, parserGaliciaPdf], detectar: detectarGalicia },
  { nombre: "santander", etiqueta: "Banco Santander", parsers: [parserSantanderCsv], detectar: detectarSantander },
  { nombre: "bbva", etiqueta: "BBVA", parsers: [parserBbvaXlsx], detectar: detectarBbva },
  { nombre: "macro", etiqueta: "Banco Macro", parsers: [parserMacroCsv], detectar: detectarMacro },
  { nombre: "nacion", etiqueta: "Banco Nación", parsers: [parserNacionCsv], detectar: detectarNacion },
  { nombre: "provincia", etiqueta: "Banco Provincia", parsers: [parserProvinciaCsv], detectar: detectarProvincia },
];

/** Nombres de banco soportados (para armar mensajes o un `<select>`). */
export function bancosSoportados(): string[] {
  return BANCOS.map((b) => b.nombre);
}

/** Bancos que ofrecen un `ParserExtracto` para ese formato (mensaje de "banco no soportado en PDF"). */
export function bancosConFormato(formato: FormatoExtracto): string[] {
  return BANCOS.filter((b) => b.parsers.some((p) => p.formato === formato)).map((b) => b.nombre);
}

/**
 * Adivina el banco por nombre de archivo y/o contenido (encabezado del
 * CSV). `null` = no reconocido.
 */
export function detectarBanco(archivo: Uint8Array, nombreArchivo: string): string | null {
  for (const banco of BANCOS) {
    if (banco.detectar(archivo, nombreArchivo)) return banco.nombre;
  }
  return null;
}

export type OpcionesParsearExtracto = {
  formato: FormatoExtracto;
  contrasena?: string;
  mapeo?: MapeoColumnas;
};

/**
 * Parsea el extracto de `nombreBanco` en el `formato` pedido. Tira (no
 * devuelve `Resultado`: esto es una utilidad de dominio/infraestructura
 * pura — quien la llama desde una Server Action la traduce a
 * `{ok:false, error}`) con mensajes en español listos para mostrar.
 */
export async function parsearExtracto(
  nombreBanco: string,
  archivo: Uint8Array,
  opciones: OpcionesParsearExtracto,
): Promise<ExtractoCuenta[]> {
  const banco = BANCOS.find((b) => b.nombre === nombreBanco);
  if (!banco) {
    throw new Error(`Banco no soportado: "${nombreBanco}". Bancos soportados: ${bancosSoportados().join(", ")}.`);
  }

  const parser = banco.parsers.find((p) => p.formato === opciones.formato);
  if (!parser) {
    if (opciones.formato === "pdf") {
      const conPdf = bancosConFormato("pdf");
      throw new Error(
        `${banco.etiqueta} no tiene extractos en PDF soportados acá. Bancos con soporte de PDF: ${conPdf.join(", ")}. Probá exportando el extracto en CSV.`,
      );
    }
    throw new Error(
      `${banco.etiqueta} no soporta el formato "${opciones.formato}" acá. Formatos soportados para ese banco: ${banco.parsers.map((p) => p.formato).join(", ")}.`,
    );
  }

  return parser.parsear(archivo, { contrasena: opciones.contrasena, mapeo: opciones.mapeo });
}
