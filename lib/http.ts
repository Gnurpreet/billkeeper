import { NextRequest, NextResponse } from 'next/server';
export function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  if (!origin) return true;
  try { return new URL(origin).host === request.headers.get('host'); } catch { return false; }
}
export async function readBody(request: NextRequest, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty request.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error('Request is too large.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
