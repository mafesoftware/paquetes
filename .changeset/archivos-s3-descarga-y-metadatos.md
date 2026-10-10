---
"@mafesoftware/archivos-s3": minor
---

Descarga forzada con el nombre original y metadatos reales al promover.

- **`urlFirmada`** acepta `descargaComo?: string` (el nombre original del
  archivo). Si viene, la URL firmada lleva `ResponseContentDisposition` =
  `attachment; filename="<ascii saneado>"; filename*=UTF-8''<percent-encoded>`
  (RFC 6266/5987): el navegador descarga el archivo en vez de abrirlo inline
  en el origen del bucket, y conserva tildes y eñes. Sin la opción, la URL es
  la misma de antes.
- **`promover`** hace `HeadObject` sobre la clave final (después de copiar y
  antes de borrar la temporal) y con `ok: true` devuelve además `tipoMime`
  (`ContentType`) y `tamanoBytes` (`ContentLength`) REALES del objeto —
  `null` si S3 no los informa — para que la app guarde esos y no los que
  declaró el cliente. Agrega una llamada a S3: un test que mockee `send`
  ahora ve tres comandos (copia, cabecera, borrado) en vez de dos.
- Nueva utilidad pura exportada **`contentDispositionAdjunto(nombre)`**, el
  valor del header que usa `urlFirmada` con `descargaComo`.
