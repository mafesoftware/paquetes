/**
 * Lo mínimo de XML que piden WSAA y WSFEv1: escapar valores, armar sobres a
 * mano y sacar valores de respuestas cuya forma es fija y conocida.
 *
 * No hay un parser de XML de verdad a propósito: las respuestas de ARCA son
 * SOAP 1.1/1.2 generado por .NET, con una forma que no cambió en quince años,
 * y un parser completo es una dependencia más para hacer `indexOf` con
 * sombrero.
 */

export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function desescaparXml(valor: string): string {
  return valor
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/*
 * El prefijo de espacio de nombres es OPCIONAL en las dos búsquedas.
 *
 * El WSFE contesta sus datos sin prefijo, pero el padrón —que es un servicio
 * Java, no .NET— puede envolverlos con uno (`<ns2:razonSocial>`). Es el mismo
 * tag: buscarlo sin contemplar el prefijo devuelve `null` y el dato se pierde
 * en silencio, que es la peor forma de fallar acá — nadie ve un error, ve una
 * razón social vacía.
 */
const conPrefijo = (etiqueta: string) =>
  `<(?:\\w+:)?${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${etiqueta}>`;

/** El texto del PRIMER `<etiqueta>…</etiqueta>`, o null si no está. */
export function valorDe(xml: string, etiqueta: string): string | null {
  const m = xml.match(new RegExp(conPrefijo(etiqueta)));
  return m ? m[1]! : null;
}

/** TODOS los bloques `<etiqueta>…</etiqueta>`, para las listas (Obs, Err). */
export function bloquesDe(xml: string, etiqueta: string): string[] {
  const re = new RegExp(conPrefijo(etiqueta), "g");
  const bloques: string[] = [];
  for (const m of xml.matchAll(re)) bloques.push(m[1]!);
  return bloques;
}
