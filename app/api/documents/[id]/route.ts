import { NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import db from '@/lib/db';
import { readDocument } from '@/lib/storage';
import { error } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return error('Sign in to continue.', 401);
  const { id } = await context.params;
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND user_id=?').get(id, user.id) as { storage: string; storage_key: string; mime: string } | undefined;
  if (!doc) return error('Document not found.', 404);
  try {
    const buffer = await readDocument(doc.storage, doc.storage_key);
    return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': doc.mime, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } catch { return error('Document is temporarily unavailable.', 503); }
}
