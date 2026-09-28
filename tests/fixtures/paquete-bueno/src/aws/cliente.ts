// Subcarpeta aws/: permitido importar @aws-sdk aquí (@mafesoftware/archivos-s3).
import type { S3Client } from '@aws-sdk/client-s3';

export function region(cliente: S3Client): unknown {
  return cliente.config.region;
}
