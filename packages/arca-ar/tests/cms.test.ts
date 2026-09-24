/**
 * La firma CMS, verificada contra openssl DE VERDAD.
 *
 * Este es el test que le da derecho a existir al encoder hecho a mano: un
 * byte corrido en el DER no falla ningún typecheck, produce un CMS que ARCA
 * rechaza con un error que no dice nada. `openssl cms -verify` valida la
 * firma criptográficamente y devuelve el contenido: si openssl lo acepta y el
 * contenido es el TRA, la estructura está bien.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emisorYSerie, firmarCMS, firmarCMSBase64, pemADer } from "../src/cms.js";
import { oid, leerTLV } from "../src/der.js";
import { certificadoDePrueba } from "./certificado.js";

const TRA = `<?xml version="1.0"?><loginTicketRequest><service>wsfe</service></loginTicketRequest>`;

describe("firmarCMS contra openssl", () => {
  it("openssl verifica la firma y recupera el contenido exacto", () => {
    const { certPem, clavePem, directorio } = certificadoDePrueba();
    const cms = firmarCMS(TRA, certPem, clavePem);

    const entrada = join(directorio, "firmado.der");
    const salida = join(directorio, "contenido.txt");
    writeFileSync(entrada, cms);

    // -noverify saltea la cadena de confianza (es un certificado inventado),
    // pero la FIRMA se verifica igual: si el DER está mal, esto explota.
    execFileSync(
      "openssl",
      ["cms", "-verify", "-in", entrada, "-inform", "DER", "-noverify", "-out", salida],
      { stdio: "pipe" }
    );

    expect(readFileSync(salida, "utf8")).toBe(TRA);
  });

  it("tambien acepta el contenido ya como Buffer, no solo como string", () => {
    const { certPem, clavePem } = certificadoDePrueba();
    const comoString = firmarCMS(TRA, certPem, clavePem);
    const comoBuffer = firmarCMS(Buffer.from(TRA, "utf8"), certPem, clavePem);
    // La firma en si difiere (RSA con padding aleatorio), pero el TAMAÑO del
    // resultado es igual: ambos caminos codifican el mismo contenido.
    expect(comoBuffer.length).toBe(comoString.length);
  });

  it("el base64 decodifica al mismo DER", () => {
    const { certPem, clavePem } = certificadoDePrueba();
    const der = firmarCMS(TRA, certPem, clavePem);
    const b64 = firmarCMSBase64(TRA, certPem, clavePem);
    expect(Buffer.from(b64, "base64").equals(der)).toBe(true);
  });

  it("la envoltura declara signedData", () => {
    const { certPem, clavePem } = certificadoDePrueba();
    const cms = firmarCMS(TRA, certPem, clavePem);
    const raiz = leerTLV(cms, 0);
    expect(raiz.etiqueta).toBe(0x30); // SEQUENCE
    const primerHijo = leerTLV(raiz.contenido, 0);
    expect(primerHijo.crudo.equals(oid("1.2.840.113549.1.7.2"))).toBe(true);
  });
});

describe("emisorYSerie", () => {
  it("saca la misma serie que reporta openssl", () => {
    const { certPem, directorio } = certificadoDePrueba();
    const { serie } = emisorYSerie(pemADer(certPem));

    const reporte = execFileSync(
      "openssl",
      ["x509", "-in", join(directorio, "cert.pem"), "-serial", "-noout"],
      { encoding: "utf8" }
    );
    const esperada = reporte.trim().split("=")[1]!.toLowerCase();
    // La serie DER trae etiqueta y longitud adelante; el valor es el resto.
    const valor = leerTLV(serie, 0).contenido.toString("hex");
    // openssl no muestra el 0x00 de relleno que DER exige cuando el primer
    // bit es 1; se compara sin él.
    expect(valor.replace(/^00/, "")).toBe(esperada.replace(/^00/, ""));
  });

  it("un PEM vacío avisa en vez de firmar cualquier cosa", () => {
    expect(() => pemADer("")).toThrow(/PEM/);
  });
});
