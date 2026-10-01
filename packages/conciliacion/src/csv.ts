/**
 * Utilidades PURAS de bajo nivel para texto plano de extractos bancarios —
 * parseo de filas CSV, importes y fechas en los formatos que usan los
 * bancos argentinos. Sin DB, sin framework: se testea sin levantar nada.
 *
 * `mapeo.ts` (mismo directorio) construye líneas de extracto a partir de
 * las filas que devuelve `parsearFilasCsv` (o `xlsx.ts`) más un
 * `MapeoColumnas`.
 */

/**
 * Parsea un CSV (separador configurable, default `,`) respetando comillas
 * dobles (campo con el separador o saltos de línea adentro, `""` = comilla
 * literal). Devuelve `string[][]` SIN normalizar — fila 0 suele ser el
 * encabezado (lo interpreta `mapeo.ts`, no acá).
 */
export function parsearFilasCsv(texto: string, separador: string = ","): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let dentroDeComillas = false;
  const normalizado = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalizado.length; i++) {
    const c = normalizado[i] ?? "";
    if (dentroDeComillas) {
      if (c === '"') {
        if (normalizado[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroDeComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') {
      dentroDeComillas = true;
    } else if (c === separador) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  // Descarta líneas completamente vacías (finales de archivo con \n colgando).
  return filas.filter((f) => !(f.length === 1 && (f[0] ?? "").trim() === ""));
}

/**
 * Importe con el criterio de los extractos argentinos: separador de miles
 * es el OTRO símbolo del `separadorDecimal` dado; paréntesis = negativo
 * (`(1.234,56)` = `-1234,56`); tolera símbolos de moneda/espacios sueltos.
 * Devuelve **centavos con signo** (`bigint`), nunca `number`.
 *
 * Deliberadamente más permisivo que `@mafesoftware/plata-ar#parsearImporte`
 * (pensado para texto tipeado por una persona, agrupamiento de miles
 * estricto, sin paréntesis): un extracto bancario es un formato fijo que ya
 * declara su propio `separadorDecimal`, no hace falta validar que un humano
 * lo haya tipeado bien.
 *
 * Ejemplos: `"1.234.567,89"` (sep. `,`) -> `123456789n`; `"-1.234,56"` ->
 * `-123456n`; `"(1.234,56)"` -> `-123456n`.
 */
export function parsearImporteAr(valorCrudo: string, separadorDecimal: "," | "."): bigint {
  let texto = valorCrudo.trim();
  if (texto === "") return 0n;

  let negativo = false;
  if (texto.startsWith("(") && texto.endsWith(")")) {
    negativo = true;
    texto = texto.slice(1, -1).trim();
  }

  // Solo dígitos, separadores y signo — fuera símbolos de moneda ("$", "US$", espacios).
  texto = texto.replace(/[^0-9,.\-]/g, "");
  if (texto.startsWith("-")) {
    negativo = true;
    texto = texto.slice(1);
  }

  const separadorMiles = separadorDecimal === "," ? "." : ",";
  texto = texto.split(separadorMiles).join("");

  const [enteroCrudo = "", decimalCrudo = ""] = texto.split(separadorDecimal);
  const entero = enteroCrudo === "" ? "0" : enteroCrudo;
  const decimal = (decimalCrudo + "00").slice(0, 2);

  const centavos = BigInt(entero) * 100n + BigInt(decimal === "" ? "0" : decimal);
  return negativo ? -centavos : centavos;
}

/**
 * Convierte una fecha en el formato que declara el banco (`"DD/MM/YYYY"`,
 * `"YYYY-MM-DD"`, `"DD-MM-YYYY"`, ...) a ISO `YYYY-MM-DD`. El formato se
 * matchea por TOKEN (D/M/Y), no por separador exacto — así un archivo con
 * `-` en vez de `/` sigue andando.
 */
export function parsearFechaConFormato(valorCrudo: string, formato: string): string {
  const tokensFormato = formato.trim().split(/[^A-Za-z]+/).filter(Boolean);
  const tokensValor = valorCrudo.trim().split(/[^0-9]+/).filter(Boolean);

  const partes: Record<string, string> = {};
  tokensFormato.forEach((token, i) => {
    const letra = token[0]?.toUpperCase();
    if (letra) partes[letra] = tokensValor[i] ?? "";
  });

  const dia = (partes.D ?? "01").padStart(2, "0");
  const mes = (partes.M ?? "01").padStart(2, "0");
  let anio = partes.Y ?? "1970";
  if (anio.length === 2) {
    anio = (Number(anio) < 50 ? "20" : "19") + anio;
  }
  return `${anio}-${mes}-${dia}`;
}
