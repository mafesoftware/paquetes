# @mafesoftware/arca-ar

Facturación electrónica de **ARCA** (ex AFIP) para Argentina, sin
dependencias: WSAA (la firma CMS del ticket de acceso, hecha a mano y
verificada contra openssl) y WSFEv1 (CAE, último autorizado, estado del
servicio), más la derivación de la letra del comprobante.

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
bun run test        # 32 tests; necesita openssl en el PATH (macOS/Linux lo traen)
bun run typecheck
bun run build
```

MIT © MAFE Software
