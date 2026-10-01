/** Re-exporta los parsers y heurísticos `detectar*` de cada banco soportado — por si alguien quiere usar uno puntual sin pasar por `parsearExtracto`/`detectarBanco`. */
export { parserGaliciaCsv, parserGaliciaPdf, detectarGalicia } from "./galicia.js";
export { parserSantanderCsv, detectarSantander } from "./santander.js";
export { parserBbvaXlsx, detectarBbva } from "./bbva.js";
export { parserMacroCsv, detectarMacro } from "./macro.js";
export { parserNacionCsv, detectarNacion } from "./nacion.js";
export { parserProvinciaCsv, detectarProvincia } from "./provincia.js";
