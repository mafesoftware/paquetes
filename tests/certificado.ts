/**
 * Un certificado y una clave de MENTIRA para los tests, generados con openssl
 * en un directorio temporal — nunca hay material criptográfico real en el
 * repo. Se generan una vez por corrida y se comparten entre archivos.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cacheado: { certPem: string; clavePem: string; directorio: string } | null =
  null;

export function certificadoDePrueba() {
  if (cacheado) return cacheado;
  const directorio = mkdtempSync(join(tmpdir(), "arca-ar-test-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      join(directorio, "clave.pem"),
      "-out",
      join(directorio, "cert.pem"),
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=prueba arca-ar/O=MAFE Software/serialNumber=CUIT 20111111112",
    ],
    { stdio: "pipe" }
  );
  cacheado = {
    certPem: readFileSync(join(directorio, "cert.pem"), "utf8"),
    clavePem: readFileSync(join(directorio, "clave.pem"), "utf8"),
    directorio,
  };
  return cacheado;
}
