# Changelog

## 0.1.0

WhatsApp por Kapso (proxy de la Cloud API de Meta): normalización de números
argentinos (`aNumeroWhatsApp`), envío de texto, plantillas, botones y listas
(`enviarTexto`, `enviarPlantilla`, `enviarBotones`, `enviarLista`,
`enviarAviso`), onboarding de un club (`crearCliente`, `crearSetupLink`) y
lectura del webhook entrante (`leerEventoWebhook`). `fetch` inyectable,
resultados en vez de excepciones.
