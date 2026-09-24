# Changelog

## 0.2.0

Consulta al padrón por CUIT (`consultarPadron`, `ticketDePadron`,
`condicionDesdePadron`) y `consultarComprobante` (FECompConsultar) para
verificar un comprobante ya emitido contra ARCA.

## 0.1.1

Las notas de crédito (`CbtesAsoc`) nombran a qué factura corrigen.

## 0.1.0

WSAA con firma CMS hecha a mano (verificada contra `openssl cms -verify`),
WSFEv1 (`solicitarCae`, `ultimoAutorizado`, `estadoDelServicio`) y la
derivación de la letra del comprobante (`letraPara`, `tipoComprobante`).
