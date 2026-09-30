/**
 * Motor genérico de importación de planillas `.xlsx`.
 *
 * Pensado para el flujo que describen las specs de los productos de MAFE
 * Software para toda pantalla de importación: "plantilla descargable, vista
 * previa, validación fila por fila (errores en rojo, con motivo), e
 * 'importar solo válidas'. Idempotente por clave natural".
 *
 * Cada importador de dominio (de la app que consume este paquete) compone
 * estas piezas en este orden:
 *   1. `leerMatriz` — I/O: lee la primera hoja de un `.xlsx` subido y la
 *      convierte en encabezado + filas de texto crudo. No valida nada.
 *   2. `mapearColumnas` — encuentra el índice real de cada campo esperado
 *      en el encabezado del archivo, SIN asumir un orden fijo ("columnas
 *      desordenadas"), con `mapeoManual` (campo → encabezado exacto del
 *      archivo) con prioridad sobre los alias automáticos.
 *   3. `filasDesdeMatriz` — arma `FilaCruda[]` (`{campo: texto}`) con esos
 *      índices.
 *   4. `previsualizar` (= `validarFilas` + `separarPorClaveNatural`) — cada
 *      importador de dominio trae su propio `validador` (PURO) y su propia
 *      `claveDe` (la clave natural del dominio: documento de un cliente,
 *      CUIT de un proveedor, código de una unidad, "índice:período"...).
 *   5. El importador de dominio (que sí puede tener I/O propio, este
 *      paquete no) llama a `previsualizar` para la vista previa y, al
 *      confirmar, solo inserta `nuevas` ("importar solo válidas") — nunca
 *      reintenta `yaImportadas` ("reimportar el mismo archivo no
 *      duplica").
 *
 * Núcleo puro (regla 1 de diseño del monorepo): sin `process.env`, sin
 * ninguna dependencia de framework — solo `exceljs` para leer el `.xlsx`.
 */
import ExcelJS from "exceljs";

// ---------------------------------------------------------------------------
// 1. Lectura del archivo (I/O)
// ---------------------------------------------------------------------------

export type CeldaValor = string | number | null;

export type MatrizArchivo = {
  /** Fila 1 del archivo, tal cual (sin normalizar). */
  encabezado: string[];
  /** Resto de las filas, EN TEXTO (una celda vacía es `""`, nunca `null` acá). */
  filas: string[][];
};

/**
 * Convierte una celda NUMÉRICA de Excel a texto en formato argentino (coma
 * decimal, sin separador de miles) en vez de `String(valor)` a secas.
 * `String(1234.56)` en JS da `"1234.56"` (coma decimal a la inglesa, sin
 * agrupar miles nunca) — indistinguible de un texto tipeado "a la inglesa"
 * para un parser que siempre lee un punto como separador de miles salvo que
 * se le diga lo contrario. Cambiar el punto por coma ACÁ, una sola vez,
 * antes de que la celda se convierta en texto, deja un string sin ningún
 * punto (nunca ambiguo: `"1234,56"`, `"1000000"`, `"-5,2"`) que el parser
 * argentino de la app que consume este paquete ya sabe leer bien, sin tocar
 * cada importador de dominio por separado.
 */
function celdaNumericaATexto(valor: number): string {
  return String(valor).replace(".", ",");
}

/** Lee la primera hoja de un `.xlsx` (fila 1 = encabezado). Puro I/O: no valida ni mapea nada. */
export async function leerMatriz(archivo: Uint8Array | ArrayBuffer): Promise<MatrizArchivo> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(archivo as ArrayBuffer);
  const hoja = libro.worksheets[0];
  if (!hoja) return { encabezado: [], filas: [] };

  let encabezado: string[] = [];
  const filas: string[][] = [];
  hoja.eachRow((fila, numeroFila) => {
    const celdas: string[] = [];
    const cantidadColumnas = Math.max(fila.cellCount, encabezado.length);
    for (let i = 1; i <= cantidadColumnas; i++) {
      const valor = fila.getCell(i).value;
      if (valor === null || valor === undefined) {
        celdas.push("");
      } else if (typeof valor === "number") {
        celdas.push(celdaNumericaATexto(valor));
      } else {
        celdas.push(String(valor).trim());
      }
    }
    if (numeroFila === 1) {
      encabezado = celdas;
      return;
    }
    filas.push(celdas);
  });
  return { encabezado, filas };
}

// ---------------------------------------------------------------------------
// 2-3. Mapeo de columnas (columnas desordenadas + mapeo manual)
// ---------------------------------------------------------------------------

export type ColumnaEsperada = {
  /** Nombre lógico del campo — la clave que usa el `validador` del importador de dominio. */
  campo: string;
  /** Encabezados aceptados (alias), tal cual pueden venir escritos en el archivo. */
  alias: readonly string[];
  /** Default `true`: si no aparece ni por alias ni por mapeo manual, queda en `faltantes`. */
  obligatoria?: boolean;
};

function normalizarEncabezado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca tildes/acentos para comparar
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export type ResultadoMapeo = {
  /** campo lógico → índice de columna en el archivo (0-based). */
  indices: Record<string, number>;
  /** campos obligatorios que no se encontraron ni por alias ni por mapeo manual. */
  faltantes: string[];
};

/**
 * Encuentra el índice real de cada columna esperada en el encabezado del
 * archivo, sin asumir que vienen en un orden fijo ("archivo con columnas
 * desordenadas"). `mapeoManual` (campo lógico → encabezado EXACTO tal cual
 * está en el archivo) gana siempre a los alias automáticos — es lo que usa
 * la pantalla cuando el archivo trae un encabezado que no matchea ningún
 * alias conocido ("mapeo manual").
 */
export function mapearColumnas(
  encabezadoArchivo: readonly string[],
  columnasEsperadas: readonly ColumnaEsperada[],
  mapeoManual?: Readonly<Record<string, string>>,
): ResultadoMapeo {
  const normalizados = encabezadoArchivo.map(normalizarEncabezado);
  const indices: Record<string, number> = {};
  const faltantes: string[] = [];

  for (const columna of columnasEsperadas) {
    let indice = -1;
    const encabezadoManual = mapeoManual?.[columna.campo];
    if (encabezadoManual !== undefined) {
      indice = normalizados.indexOf(normalizarEncabezado(encabezadoManual));
    }
    if (indice === -1) {
      for (const alias of columna.alias) {
        indice = normalizados.indexOf(normalizarEncabezado(alias));
        if (indice !== -1) break;
      }
    }
    if (indice === -1) {
      if (columna.obligatoria !== false) faltantes.push(columna.campo);
      continue;
    }
    indices[columna.campo] = indice;
  }

  return { indices, faltantes };
}

export type FilaCruda = Record<string, string>;

/** Arma `FilaCruda[]` (`{campo: texto}`) a partir de la matriz de datos (sin encabezado) y el mapeo de `mapearColumnas`. */
export function filasDesdeMatriz(
  matrizDatos: readonly (string | number | null | undefined)[][],
  indices: Readonly<Record<string, number>>,
): FilaCruda[] {
  return matrizDatos.map((fila) => {
    const filaCruda: FilaCruda = {};
    for (const [campo, indice] of Object.entries(indices)) {
      const valor = fila[indice];
      filaCruda[campo] = valor === null || valor === undefined ? "" : String(valor).trim();
    }
    return filaCruda;
  });
}

// ---------------------------------------------------------------------------
// 4. Validación fila por fila (nunca aborta el resto)
// ---------------------------------------------------------------------------

export type ErrorFila = { fila: number; error: string };
export type FilaValida<T> = { fila: number; datos: T };

export type ResultadoValidacion<T> = {
  validas: FilaValida<T>[];
  errores: ErrorFila[];
};

export type Validador<T> = (fila: FilaCruda, numeroFila: number) => { ok: true; datos: T } | { ok: false; error: string };

/**
 * Valida cada fila con `validador` (PURO, nunca tira). Una fila con error
 * queda en `errores` CON su número y motivo — nunca aborta la importación
 * entera. `numeroFila` es base 1 + 1 por el encabezado, así coincide con el
 * número de fila que el usuario ve en Excel.
 */
export function validarFilas<T>(filas: readonly FilaCruda[], validador: Validador<T>): ResultadoValidacion<T> {
  const validas: FilaValida<T>[] = [];
  const errores: ErrorFila[] = [];
  filas.forEach((fila, indice) => {
    const numeroFila = indice + 2;
    const resultado = validador(fila, numeroFila);
    if (resultado.ok) validas.push({ fila: numeroFila, datos: resultado.datos });
    else errores.push({ fila: numeroFila, error: resultado.error });
  });
  return { validas, errores };
}

// ---------------------------------------------------------------------------
// 5. Idempotencia por clave natural
// ---------------------------------------------------------------------------

export type ClasificacionIdempotente<T> = {
  /** Filas nuevas: son las que se insertan. */
  nuevas: FilaValida<T>[];
  /** Clave natural ya vista (en el archivo o en lo que ya existe): se omiten, NO es un error. */
  yaImportadas: (FilaValida<T> & { clave: string })[];
};

/**
 * Separa nuevas de ya-importadas por CLAVE NATURAL ("idempotentes por clave
 * natural", ej. unidad = proyecto+código). `clavesExistentes` la arma el
 * importador de dominio consultando lo que ya existe; duplicados DENTRO del
 * mismo archivo (la misma fila repetida, o reimportar el mismo archivo dos
 * veces con las mismas claves) también quedan en `yaImportadas` — primera
 * aparición gana.
 */
export function separarPorClaveNatural<T>(
  validas: readonly FilaValida<T>[],
  claveDe: (datos: T) => string,
  clavesExistentes: ReadonlySet<string> = new Set(),
): ClasificacionIdempotente<T> {
  const vistas = new Set(clavesExistentes);
  const nuevas: FilaValida<T>[] = [];
  const yaImportadas: (FilaValida<T> & { clave: string })[] = [];

  for (const fila of validas) {
    const clave = claveDe(fila.datos);
    if (vistas.has(clave)) {
      yaImportadas.push({ ...fila, clave });
      continue;
    }
    vistas.add(clave);
    nuevas.push(fila);
  }

  return { nuevas, yaImportadas };
}

export type VistaPrevia<T> = ResultadoValidacion<T> & ClasificacionIdempotente<T>;

/**
 * La vista previa completa que ve el usuario antes de confirmar: valida
 * fila por fila y separa nuevas / ya-importadas / con error. "Importar solo
 * válidas" = insertar `nuevas` (las `validas` que además no son
 * `yaImportadas`).
 */
export function previsualizar<T>(
  filas: readonly FilaCruda[],
  validador: Validador<T>,
  claveDe: (datos: T) => string,
  clavesExistentes?: ReadonlySet<string>,
): VistaPrevia<T> {
  const { validas, errores } = validarFilas(filas, validador);
  const { nuevas, yaImportadas } = separarPorClaveNatural(validas, claveDe, clavesExistentes);
  return { validas, errores, nuevas, yaImportadas };
}
