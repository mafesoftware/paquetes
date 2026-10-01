/**
 * Parsing PURO del padrón de IIBB (formato que publican ARBA/AGIP para sus
 * agentes de retención/percepción): separado por `|`, fechas `ddmmaaaa`,
 * alícuota con coma decimal (se normaliza a punto).
 *
 * Una fila ARBA trae un solo campo "régimen" (`R`=retención, `P`=percepción)
 * con una sola alícuota; una fila AGIP trae las DOS alícuotas juntas
 * (percepción y retención) — por eso `parsearLineaAgip` devuelve hasta dos
 * `FilaPadron` por línea. Ninguna de las dos funciones tira: una línea
 * malformada vuelve `{ ok: false, error }` con el detalle, y quien orquesta
 * la importación del archivo completo (del lado de la app) decide seguir
 * con el resto — mismo criterio que cualquier importador línea a línea que
 * no aborta todo el archivo por una fila mala.
 */
import type { FilaPadron, FilaPadronConOrigen, TipoPadron } from "./tipos.js";

function fechaDdmmaaaaAIso(valor: string): string | null {
  if (!/^\d{8}$/.test(valor)) return null;
  const dia = valor.slice(0, 2);
  const mes = valor.slice(2, 4);
  const anio = valor.slice(4, 8);
  const iso = `${anio}-${mes}-${dia}`;
  const fecha = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return null;
  return iso;
}

function alicuotaConComaANumero(valor: string): string | null {
  const limpio = valor.trim();
  if (!/^\d+(,\d+)?$/.test(limpio)) return null;
  return limpio.replace(",", ".");
}

function cuitValido(valor: string): boolean {
  return /^\d{11}$/.test(valor);
}

export type ResultadoParseoArba = { ok: true; fila: FilaPadron } | { ok: false; error: string };

/**
 * Campos, en orden (`docs/fiscal/formatos/padron-arba.md`): régimen (R|P) |
 * fecha publicación (ddmmaaaa, informativa, no se persiste) | vigencia
 * desde (ddmmaaaa) | vigencia hasta (ddmmaaaa, vacío = sin fin) | CUIT (11
 * dígitos) | tipo contribuyente (C|D, informativo) | marca alta/baja (A|B) |
 * marca cambio de alícuota (S|N, informativa) | alícuota (con coma) | grupo.
 */
export function parsearLineaArba(linea: string): ResultadoParseoArba {
  const campos = linea.split("|");
  if (campos.length !== 10) {
    return { ok: false, error: `Se esperaban 10 campos separados por "|", vinieron ${campos.length}.` };
  }
  const [regimenRp, , vigenciaDesdeCruda, vigenciaHastaCruda, cuit, , marcaAltaBaja, , alicuotaCruda, grupo] = campos as [
    string, string, string, string, string, string, string, string, string, string,
  ];

  if (regimenRp !== "R" && regimenRp !== "P") return { ok: false, error: `Régimen inválido: "${regimenRp}" (se esperaba R o P).` };
  const tipo: TipoPadron = regimenRp === "R" ? "retencion" : "percepcion";

  if (marcaAltaBaja === "B") return { ok: false, error: "Fila de baja: no se importa." };

  if (!cuitValido(cuit)) return { ok: false, error: `CUIT inválido: "${cuit}".` };

  const vigenteDesde = fechaDdmmaaaaAIso(vigenciaDesdeCruda);
  if (!vigenteDesde) return { ok: false, error: `Fecha de vigencia desde inválida: "${vigenciaDesdeCruda}".` };
  const vigenteHasta = vigenciaHastaCruda.trim() === "" ? null : fechaDdmmaaaaAIso(vigenciaHastaCruda);
  if (vigenciaHastaCruda.trim() !== "" && !vigenteHasta) {
    return { ok: false, error: `Fecha de vigencia hasta inválida: "${vigenciaHastaCruda}".` };
  }

  const alicuota = alicuotaConComaANumero(alicuotaCruda);
  if (!alicuota) return { ok: false, error: `Alícuota inválida: "${alicuotaCruda}".` };

  return {
    ok: true,
    fila: { cuit, tipo, alicuota, vigenteDesde, vigenteHasta, grupo: grupo.trim() || null, razonSocialContribuyente: null },
  };
}

export type ResultadoParseoAgip = { ok: true; filas: FilaPadron[] } | { ok: false; error: string };

/**
 * Campos, en orden (`docs/fiscal/formatos/padron-agip.md`): fecha
 * publicación (ddmmaaaa, informativa) | vigencia desde (ddmmaaaa) |
 * vigencia hasta (ddmmaaaa, vacío = sin fin) | CUIT (11 dígitos) | tipo
 * contribuyente (informativo) | marca alta/baja (A|B) | marca cambio de
 * alícuota (informativa) | alícuota percepción (con coma) | alícuota
 * retención (con coma) | grupo | razón social. Una línea válida produce
 * DOS filas (percepción + retención), salvo que una de las dos alícuotas
 * venga vacía (contribuyente sin ese régimen).
 */
export function parsearLineaAgip(linea: string): ResultadoParseoAgip {
  const campos = linea.split("|");
  if (campos.length !== 11) {
    return { ok: false, error: `Se esperaban 11 campos separados por "|", vinieron ${campos.length}.` };
  }
  const [, vigenciaDesdeCruda, vigenciaHastaCruda, cuit, , marcaAltaBaja, , percepcionCruda, retencionCruda, grupo, razonSocial] = campos as [
    string, string, string, string, string, string, string, string, string, string, string,
  ];

  if (marcaAltaBaja === "B") return { ok: false, error: "Fila de baja: no se importa." };
  if (!cuitValido(cuit)) return { ok: false, error: `CUIT inválido: "${cuit}".` };

  const vigenteDesde = fechaDdmmaaaaAIso(vigenciaDesdeCruda);
  if (!vigenteDesde) return { ok: false, error: `Fecha de vigencia desde inválida: "${vigenciaDesdeCruda}".` };
  const vigenteHasta = vigenciaHastaCruda.trim() === "" ? null : fechaDdmmaaaaAIso(vigenciaHastaCruda);
  if (vigenciaHastaCruda.trim() !== "" && !vigenteHasta) {
    return { ok: false, error: `Fecha de vigencia hasta inválida: "${vigenciaHastaCruda}".` };
  }

  const filas: FilaPadron[] = [];
  const grupoNormalizado = grupo.trim() || null;
  const razonSocialNormalizada = razonSocial.trim() || null;

  if (percepcionCruda.trim() !== "") {
    const alicuota = alicuotaConComaANumero(percepcionCruda);
    if (!alicuota) return { ok: false, error: `Alícuota de percepción inválida: "${percepcionCruda}".` };
    filas.push({ cuit, tipo: "percepcion", alicuota, vigenteDesde, vigenteHasta, grupo: grupoNormalizado, razonSocialContribuyente: razonSocialNormalizada });
  }
  if (retencionCruda.trim() !== "") {
    const alicuota = alicuotaConComaANumero(retencionCruda);
    if (!alicuota) return { ok: false, error: `Alícuota de retención inválida: "${retencionCruda}".` };
    filas.push({ cuit, tipo: "retencion", alicuota, vigenteDesde, vigenteHasta, grupo: grupoNormalizado, razonSocialContribuyente: razonSocialNormalizada });
  }

  if (filas.length === 0) return { ok: false, error: "Sin alícuota de percepción ni de retención." };
  return { ok: true, filas };
}

/**
 * Elige la alícuota vigente a `fecha` entre las candidatas ya filtradas por
 * cuit+tipo (`alicuotaPadron(...) → string | null`). Un
 * override de la organización (`origen: "organizacion"`) gana siempre sobre
 * el global; entre varias globales vigentes (reimportaciones con distinta
 * `vigenteDesde`), gana la de vigencia más reciente.
 */
export function elegirAlicuotaVigente(filas: readonly FilaPadronConOrigen[], fecha: string): string | null {
  const vigentes = filas.filter((f) => f.vigenteDesde <= fecha && (f.vigenteHasta === null || fecha <= f.vigenteHasta));
  if (vigentes.length === 0) return null;

  const deOrganizacion = vigentes.filter((f) => f.origen === "organizacion");
  const candidatas = deOrganizacion.length > 0 ? deOrganizacion : vigentes;
  const masReciente = [...candidatas].sort((a, b) => (a.vigenteDesde < b.vigenteDesde ? 1 : a.vigenteDesde > b.vigenteDesde ? -1 : 0))[0];
  return masReciente?.alicuota ?? null;
}
