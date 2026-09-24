/**
 * Documentos e identidad bancaria argentina: CUIT/CUIL, DNI, CBU/CVU, alias
 * y teléfonos. Puro, sin dependencias — lo importan tanto el servidor como
 * los formularios del panel.
 *
 * Un dato de este tipo mal validado no falla en el momento: el CUIT decide
 * la letra de una factura y viaja a ARCA, que lo rechaza sin explicar nada
 * útil semanas después; un CBU mal tipeado hace que una transferencia caiga
 * en la cuenta de otra persona, no en un error. Por eso ninguna función de
 * acá **tira**: la entrada de un usuario, con guiones, puntos o espacios de
 * más, es un dato de negocio — se devuelve `{ ok: false, motivo, codigo }`,
 * nunca una excepción.
 *
 * - `cuit.ts`: `validarCuit`, `formatearCuit`.
 * - `dni.ts`: `validarDni`.
 * - `cbu.ts`: `validarCbu`, `validarCvu`.
 * - `alias.ts`: `validarAlias`.
 * - `enmascarar.ts`: `enmascarar`.
 * - `telefono.ts`: `telefonoAE164`, `aWhatsApp`.
 * - `condiciones-iva.ts`: `CONDICIONES_IVA`.
 */
export * from "./cuit.js";
export * from "./dni.js";
export * from "./cbu.js";
export * from "./alias.js";
export * from "./enmascarar.js";
export * from "./telefono.js";
export * from "./condiciones-iva.js";
