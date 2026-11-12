import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export const documentRoot = resolve(process.env.DOCUMENTS_PATH || './data/documents');
export function objectClient() {
  const endpoint = process.env.HETZNER_OS_ENDPOINT, accessKeyId = process.env.HETZNER_OS_ACCESS_KEY, secretAccessKey = process.env.HETZNER_OS_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey || !process.env.HETZNER_OS_BUCKET) throw new Error('Object storage configuration is incomplete.');
  return new S3Client({ endpoint, region: process.env.HETZNER_OS_REGION || 'eu-central-1', credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true });
}
// shortcut: originals from abandoned/deleted receipts stay private in storage; add retention cleanup before high-volume use.
export async function saveDocument(id: string, buffer: Buffer, mime: string) {
  if (process.env.HETZNER_OS_BUCKET) {
    const key = `billkeeper/documents/${id}`;
    await objectClient().send(new PutObjectCommand({ Bucket: process.env.HETZNER_OS_BUCKET, Key: key, Body: buffer, ContentType: mime }));
    return { storage: 's3', key };
  }
  await mkdir(documentRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(documentRoot, id), buffer, { mode: 0o600, flag: 'wx' });
  return { storage: 'local', key: id };
}
export async function readDocument(storage: string, key: string) {
  if (storage === 's3') {
    const response = await objectClient().send(new GetObjectCommand({ Bucket: process.env.HETZNER_OS_BUCKET, Key: key }));
    if (!response.Body) throw new Error('Document is unavailable.');
    return Buffer.from(await response.Body.transformToByteArray());
  }
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid document key.');
  return readFile(join(documentRoot, key));
}
export function validateFile(buffer: Buffer, mime: string) {
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('Choose a non-empty document up to 10 MB.');
  const valid = mime === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    || mime === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || mime === 'image/webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    || mime === 'application/pdf' && buffer.toString('ascii', 0, 5) === '%PDF-';
  if (!valid) throw new Error('Choose a valid JPEG, PNG, WebP image or PDF.');
}
