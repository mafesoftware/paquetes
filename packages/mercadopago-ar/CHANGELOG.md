# Changelog

## 0.1.0

Integración de Mercado Pago para Argentina: Checkout Pro (`crearPreferencia`
con comisión opcional), OAuth de marketplace (`iniciarVinculacion`,
`resolverVinculacion`, `canjearCodigo`, `refrescarToken`), verificación de la
firma del webhook (`verificarFirmaWebhook`), lectura normalizada del aviso
(`leerNotificacion`) y el orquestador idempotente
(`procesarNotificacionDePago`, `reconciliarPago`). Adaptador `/next` con la
ruta del webhook y el andamio del OAuth.
