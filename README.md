# @mafesoftware/arca-ar

Facturación electrónica de **ARCA** (ex AFIP) para Argentina, sin
dependencias: WSAA (la firma CMS del ticket de acceso, hecha a mano y
verificada contra openssl) y WSFEv1 (CAE, último autorizado, consulta de un
comprobante emitido, estado del servicio), más la derivación de la letra del
comprobante y la **consulta al padrón** por CUIT.

- **Toda la plata en CENTAVOS.** El wire decimal de ARCA ("1234.56") es un
  detalle interno: se convierte una sola vez, en el borde.
- **`fetch` inyectable** en todas las llamadas: los tests no hablan con ARCA.
- **Sin estado.** El ticket del WSAA dura 12 horas y pedir otro con uno
  vigente es un error de ARCA: guardarlo es responsabilidad de quien llama.

## El flujo entero

```ts
import {
  solicitarTicket,
  tipoComprobante,
  ultimoAutorizado,
  solicitarCae,
  CONDICION_IVA_ID,
  DOC_TIPO,
} from "@mafesoftware/arca-ar";

// 1. El ticket de acceso (guardalo: dura 12 horas).
const ticket = await solicitarTicket({
  servicio: "wsfe",
  certificadoPem: CERT,       // el que emitió ARCA
  clavePrivadaPem: CLAVE,
  entorno: "homologacion",    // o "produccion"
});

const auth = { token: ticket.token, sign: ticket.sign, cuit: "20111111112" };

// 2. Qué comprobante corresponde.
const { codigo } = tipoComprobante("monotributo", "consumidor_final"); // C → 11

// 3. El número lo asigna quien emite: último + 1.
const ultimo = await ultimoAutorizado({
  auth, puntoVenta: 3, tipoComprobante: codigo, entorno: "homologacion",
});

// 4. El CAE.
const r = await solicitarCae({
  auth,
  entorno: "homologacion",
  comprobante: {
    puntoVenta: 3,
    tipoComprobante: codigo,
    numero: ultimo + 1,
    concepto: 1,
    docTipo: DOC_TIPO.sin_identificar,
    docNumero: "0",
    condicionIVAReceptorId: CONDICION_IVA_ID.consumidor_final,
    fecha: new Date(),
    totalCent: 1210000,  // $12.100,00
    netoCent: 1210000,   // C: el IVA no se discrimina
    ivaCent: 0,
  },
});
// r.resultado: "aprobado" | "rechazado" · r.cae · r.caeVence · r.observaciones
```

Un comprobante **aprobado con observaciones vale igual**: guardalas, son el
aviso de que algo se está declarando raro. Un **rechazo no es una excepción**
(es un resultado, con el motivo en `observaciones`); las excepciones son para
errores de infraestructura o de datos (`ErrorWSAA`, `ErrorWsfe`).

## Verificar un comprobante emitido

```ts
import { consultarComprobante } from "@mafesoftware/arca-ar";

const enArca = await consultarComprobante({
  auth: { token, sign, cuit },
  puntoVenta: 1,
  tipoComprobante: 6,
  numero: 42,
  entorno: "produccion",
});

if (!enArca.existe) {
  // ARCA no lo tiene: lo que haya guardado es un CAE que nunca se autorizó.
} else if (enArca.cae !== caeGuardado) {
  // Los dos existen y no coinciden.
}
```

**El «no lo tengo» no es un error.** ARCA lo informa con el código 602 adentro
de un HTTP 200, y acá se traduce a `existe: false` en vez de tirar: es la
respuesta más importante de toda la consulta. Cualquier otro código sí lanza
`ErrorWsfe`.

## El padrón: quién es un CUIT

```ts
import { ticketDePadron, consultarPadron } from "@mafesoftware/arca-ar";

// Es un servicio APARTE del wsfe: necesita su propio ticket, y hay que
// habilitarlo en el certificado desde el sitio de ARCA.
const ticket = await ticketDePadron({
  certificadoPem,
  clavePrivadaPem,
  entorno: "produccion",
});

const persona = await consultarPadron({
  token: ticket.token,
  sign: ticket.sign,
  cuitConsultante: cuitDelComercio,
  cuit: "20-11111111-2",
  entorno: "produccion",
});
// null = ARCA no lo conoce (no existe, o está de baja). No es un error.
```

`condicionIva` puede venir en **`null`**, y eso es deliberado: ARCA no informa
una condición sino los *impuestos* en los que la persona está inscripta (30 =
IVA, 20 = monotributo). Sin ninguno de los dos no se asume nada — caer en
"consumidor final" por defecto haría que un responsable inscripto reciba una
factura B, que es justo lo que consultar el padrón viene a evitar.

## La firma CMS

ARCA pide el TRA firmado en CMS/PKCS#7. Acá el `SignedData` se construye a
mano (son siete TLVs de DER) y **los tests lo verifican con
`openssl cms -verify`**: si openssl acepta la firma y recupera el TRA byte
por byte, la estructura está bien. No hay material criptográfico en el repo:
los tests generan un certificado descartable por corrida.

## Qué NO hace

- No guarda tickets, numeración ni comprobantes: eso es de tu base.
- No decide el IVA de tus productos: recibe el desglose ya calculado.
- No maneja los certificados: generarlos y asociarlos al servicio se hace una
  vez en el sitio de ARCA.

## Desarrollo

```
bun install
bun run test        # 51 tests; necesita openssl en el PATH (macOS/Linux lo traen)
bun run typecheck
bun run build
```

MIT © MAFE Software
