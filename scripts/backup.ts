import db from '../lib/db';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { documentRoot, objectClient } from '../lib/storage';
import Database from 'better-sqlite3';

const destination = resolve(process.argv[2] || `data/backups/${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(destination, { recursive: true, mode: 0o700 });
const databaseFile = join(destination, 'billkeeper.sqlite');
await db.backup(databaseFile);
await chmod(databaseFile, 0o600);
const snapshot = new Database(databaseFile, { readonly: true });
try {
  if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup integrity check failed.');
  const files = snapshot.prepare("SELECT storage_key FROM documents WHERE storage='local'").all() as { storage_key: string }[];
  await mkdir(join(destination, 'documents'), { mode: 0o700 });
  for (const file of files) {
    if (!/^[a-f0-9-]{36}$/.test(file.storage_key)) throw new Error('Invalid stored document key.');
    const target = join(destination, 'documents', file.storage_key);
    await copyFile(join(documentRoot, file.storage_key), target); await chmod(target, 0o600);
  }
  if (process.env.HETZNER_OS_BUCKET) {
    // Local documents need their own off-server backup if storage was switched to S3 later.
    if (files.length) throw new Error('Backup is local only: copy local documents off-server before enabling remote database backups.');
    await objectClient().send(new PutObjectCommand({ Bucket: process.env.HETZNER_OS_BUCKET, Key: `billkeeper/backups/${new Date().toISOString()}.sqlite`, Body: await readFile(databaseFile), ContentType: 'application/x-sqlite3' }));
  }
  console.log(`Verified backup created at ${destination}`);
} finally { snapshot.close(); db.close(); }
