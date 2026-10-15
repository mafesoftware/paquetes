---
"@mafesoftware/correo": minor
---

`enviarCorreo` acepta `cc` y `cco` (copia oculta), una dirección o una lista. Viajan a Resend como `cc` y `bcc`, limpias de espacios, y una dirección que no tiene forma de mail se rechaza antes de la red (`rechazado`). Sin ellas el pedido es el mismo de antes. Para avisarle lo mismo a varias personas sin que se vean entre sí, conviene un envío por persona: un mail con el "Para" vacío y todos en CCO es lo que los filtros de spam miran mal.
