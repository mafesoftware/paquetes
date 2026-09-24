/**
 * La cáscara HTML de los mails, con la marca de cada producto.
 *
 * Es UNA plantilla para todos los mails de un producto a propósito: veinte
 * mails con veinte cáscaras son veinte lugares donde arreglar el mismo bug de
 * render en Gmail. El contenido (el `cuerpoHtml`) lo arma cada aplicación; la
 * cáscara pone el encabezado con la marca, el ancho, la tipografía y el pie.
 *
 * Todo va con estilos EN LÍNEA: los clientes de correo ignoran `<style>` con
 * alegría, y Gmail recorta lo que no entiende.
 */

const MAPA_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

/**
 * Escapa texto para meterlo en HTML. Todo lo que venga de un usuario —nombres,
 * direcciones, notas— pasa por acá antes de entrar al cuerpo de un mail: un
 * cliente que se llama `<script>` no puede convertirse en un mail que ejecuta.
 */
export function escapeHtml(valor: string): string {
  return valor.replace(/[&<>"']/g, (letra) => MAPA_ESCAPES[letra]!);
}

export type MarcaCorreo = {
  /** El nombre que encabeza el mail: "Bestie K-Beauty", "Consult360". */
  nombre: string;
  /** La línea chica debajo del nombre. Vacía = no se dibuja. */
  bajada?: string;
  /** El color del encabezado. */
  colorFondo?: string;
  /** El color de los botones (`botonCorreo` lo toma como default). */
  colorAccion?: string;
};

const FONDO_POR_DEFECTO = "#1f2937";
const ACCION_POR_DEFECTO = "#1f2937";

/**
 * Un botón de acción. `texto` se escapa acá; la URL la arma el que llama (y
 * por eso se escapa también: una URL con comillas no puede cerrar el atributo).
 */
export function botonCorreo(url: string, texto: string, color?: string): string {
  return `<p style="margin:24px 0 4px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${color ?? ACCION_POR_DEFECTO};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">${escapeHtml(texto)}</a></p>`;
}

/**
 * Envuelve el cuerpo con la cáscara de la marca.
 *
 * `cuerpoHtml` entra SIN escapar —es HTML que armó la aplicación—; lo que sí
 * se escapa es todo lo de `marca` y el `pie`, que son texto.
 */
export function plantillaCorreo(opciones: {
  marca: MarcaCorreo;
  cuerpoHtml: string;
  /** El renglón legal de abajo. */
  pie?: string;
}): string {
  const { marca } = opciones;
  const fondo = marca.colorFondo ?? FONDO_POR_DEFECTO;
  const bajada = marca.bajada
    ? `<div style="margin-top:6px;color:rgba(255,255,255,.75);font-size:13px">${escapeHtml(marca.bajada)}</div>`
    : "";
  const pie =
    opciones.pie ??
    "Este mensaje se mandó solo. Si no lo esperabas, podés ignorarlo.";

  return `<div style="margin:0;background:#f3f4f6;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.6"><div style="max-width:600px;margin:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden"><div style="padding:22px 28px;background:${fondo};color:#ffffff"><div style="font-size:20px;font-weight:800;letter-spacing:-.3px">${escapeHtml(marca.nombre)}</div>${bajada}</div><div style="padding:28px">${opciones.cuerpoHtml}<p style="color:#6b7280;font-size:12px;margin:28px 0 0;padding-top:16px;border-top:1px solid #eceef0">${escapeHtml(pie)}</p></div></div></div>`;
}
