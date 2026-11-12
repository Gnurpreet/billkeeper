import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'billkeeper-api-'));
process.env.DATABASE_PATH = join(root, 'db.sqlite');
process.env.DOCUMENTS_PATH = join(root, 'documents');
process.env.APP_URL = 'http://localhost:3026';
process.env.GEMINI_API_KEY = '';
process.env.HETZNER_OS_BUCKET = '';
await import('next/dist/server/node-environment.js');
const { NextRequest } = await import('next/server');
const { workAsyncStorage } = require('next/dist/server/app-render/work-async-storage.external.js');
const { workUnitAsyncStorage } = require('next/dist/server/app-render/work-unit-async-storage.external.js');
const { createRequestStoreForAPI } = require('next/dist/server/async-storage/request-store.js');
const action = await import('../app/api/action/route');
const scan = await import('../app/api/scan/route');
const documents = await import('../app/api/documents/[id]/route');
const reports = await import('../app/api/reports/[id]/route');
const { default: db } = await import('../lib/db');
db.prepare('UPDATE currency_fetch_state SET last_attempt_at=? WHERE id=1').run(Date.now());
const { requestPasswordReset, resetPassword } = await import('../lib/auth');

class Client {
  cookie = '';
  async call(path = '/api/action', data?: Record<string, unknown> | FormData, extraHeaders?: Record<string, string>) {
    const headers = new Headers({ host: 'localhost:3026', cookie: this.cookie, ...extraHeaders });
    const body = data instanceof FormData ? data : data ? JSON.stringify(data) : undefined;
    if (data && !(data instanceof FormData)) headers.set('Content-Type','application/json');
    const request = new NextRequest(`http://localhost:3026${path}`, { method: data ? 'POST' : 'GET', headers, body });
    const store = createRequestStoreForAPI(request, request.nextUrl, { tags: [], expirationsByCacheKind: new Map() }, (cookies: string[]) => { this.cookie = cookies.map(c => c.split(';')[0]).join('; '); }, undefined);
    const id = path.split('/').pop()!;
    return workAsyncStorage.run({ route: path, isStaticGeneration: false }, () => workUnitAsyncStorage.run(store, () => path === '/api/action' ? data ? action.POST(request) : action.GET() : path === '/api/scan' ? scan.POST(request) : path.startsWith('/api/documents/') ? documents.GET(request, { params: Promise.resolve({ id }) }) : reports.GET(request, { params: Promise.resolve({ id }) })));
  }
  post(data: Record<string, unknown>) { return this.call('/api/action',data); }
  async signup() { const email = `${randomUUID()}@example.com`; const response = await this.post({ action: 'signup',email,password:'long-test-password' }); assert.equal(response.status,200,await response.text()); return email; }
}
const record = () => ({ action:'saveReceipt', id:randomUUID(), vendor:'Test shop', date:'2026-11-12', category:'meals', currency:'INR', amount:'100.25', summary:'Lunch' });

test('real handlers enforce sessions, ownership, validation, immutable reports and safe retries', async () => {
  const a = new Client(), b = new Client();
  assert.equal((await a.call()).status,401); await a.signup(); await b.signup();
  assert.equal((await a.call('/api/action',record(),{origin:'https://evil.example'})).status,403);
  assert.equal((await a.post({...record(),amount:'-1'})).status,400);
  const upload = new FormData(); upload.set('file',new File([Buffer.from('%PDF-1.4\n%%EOF')],'receipt.pdf',{type:'application/pdf'}));
  const uploaded = await a.call('/api/scan',upload); assert.equal(uploaded.status,200);
  const doc = await uploaded.json(); assert.ok(doc.document_id); assert.match(doc.warning,/not configured/);
  const receipt = {...record(),document_id:doc.document_id};
  assert.equal((await a.post(receipt)).status,200); assert.equal((await a.post(receipt)).status,200);
  assert.equal((await a.post({...receipt,id:randomUUID()})).status,409);
  assert.equal((await b.call('/api/documents/'+doc.document_id)).status,404);
  assert.equal((await b.post({...receipt,vendor:'Stolen'})).status,409);
  assert.equal((await b.post({action:'deleteReceipt',id:receipt.id})).status,404);
  const ownDoc = await a.call('/api/documents/'+doc.document_id); assert.equal(ownDoc.status,200); assert.equal(await ownDoc.text(),'%PDF-1.4\n%%EOF'); assert.match(ownDoc.headers.get('cache-control')!,/no-store/);
  const state = await (await a.call()).json(); assert.equal(state.receipts.length,1); assert.equal(state.receipts[0].inr_minor,10025);
  const report = {action:'closeReport',id:randomUUID(),ids:[receipt.id],name:'Trip',total_inr_minor:1};
  assert.equal((await a.post(report)).status,200); assert.equal((await a.post(report)).status,200);
  assert.equal((await a.post(receipt)).status,409); assert.equal((await a.post({action:'deleteReceipt',id:receipt.id})).status,404);
  assert.equal((await b.call('/api/reports/'+report.id)).status,404);
  assert.match(await (await a.call('/api/reports/'+report.id)).text(),/100.25/);
  assert.equal((await a.post({action:'deleteReport',id:report.id})).status,200);
  assert.equal((await (await a.call()).json()).receipts.length,0);
  assert.equal((await a.post({action:'logout'})).status,200); assert.equal((await a.call('/api/documents/'+doc.document_id)).status,401);
});

test('bad uploads are rejected and chunked oversized action bodies are bounded', async () => {
  const client = new Client(); await client.signup();
  const bad = new FormData(); bad.set('file',new File(['<script>bad</script>'],'bad.jpg',{type:'image/jpeg'}));
  assert.equal((await client.call('/api/scan',bad)).status,400);
  assert.equal((await client.post({action:'saveReceipt',summary:'x'.repeat(130_000)})).status,400);
});

test('password resets expire, work once and revoke all old sessions', async () => {
  const client = new Client(); const email = await client.signup();
  process.env.RESEND_API_KEY = 'test'; process.env.EMAIL_FROM = 'Billkeeper <test@example.com>';
  const originalFetch = globalThis.fetch; let link = '';
  globalThis.fetch = async (_url, init) => { const mail = JSON.parse(String(init?.body)); link = mail.text.match(/http[^\s]+/)[0]; return Response.json({ id:'test' }); };
  try { await requestPasswordReset(email); } finally { globalThis.fetch = originalFetch; }
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('reset-password')!;
  assert.ok(token); assert.equal(resetPassword(token,'replacement-password'),true); assert.equal(resetPassword(token,'replacement-password'),false);
  assert.equal((await client.call()).status,401);
  assert.equal((await client.post({action:'login',email,password:'replacement-password'})).status,200);
  const fake = 'f'.repeat(64);
  const { createHash } = await import('node:crypto');
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id:number };
  db.prepare('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(fake).digest('hex'),user.id,Date.now()-1);
  assert.equal(resetPassword(fake,'replacement-password'),false);
});

test('Gemini extraction is server-side and failure keeps the uploaded document for manual review', async () => {
  const client = new Client(); await client.signup();
  process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ vendor: 'Scanned cafe', date: '', amount: '25.00', currency: 'INR', category: 'meals', summary: 'Coffee' }) }] } }] });
    const file = new FormData(); file.set('file',new File([Buffer.from('%PDF-1.4 scan')],'bill.pdf',{type:'application/pdf'}));
    const result = await (await client.call('/api/scan',file)).json();
    assert.equal(result.fields.vendor,'Scanned cafe'); assert.equal(result.fields.date,''); assert.ok(result.document_id);
    assert.equal((await client.post({...record(), ...result.fields, document_id:result.document_id})).status,400);
    globalThis.fetch = async () => { throw new Error('Provider unavailable'); };
    const failed = new FormData(); failed.set('file',new File([Buffer.from('%PDF-1.4 failed')],'bill.pdf',{type:'application/pdf'}));
    const fallback = await (await client.call('/api/scan',failed)).json();
    assert.ok(fallback.document_id); assert.match(fallback.warning,/Scanning failed/);
    assert.equal((await client.call('/api/documents/'+fallback.document_id)).status,200);
  } finally { globalThis.fetch = originalFetch; process.env.GEMINI_API_KEY = ''; }
});

test('scan failures identify model access and quota without exposing provider secrets', async () => {
  const client = new Client(); await client.signup();
  process.env.GEMINI_API_KEY = 'test-secret-key';
  const originalFetch = globalThis.fetch, originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(JSON.stringify(args));
  try {
    for (const [status, code, expected] of [[404, 'NOT_FOUND', /model.*unavailable/i], [429, 'RESOURCE_EXHAUSTED', /quota|rate limit/i], [403, 'PERMISSION_DENIED', /permission|access/i]] as const) {
      globalThis.fetch = async () => Response.json({ error: { code: status, status: code, message: 'Provider error with test-secret-key' } }, { status });
      const file = new FormData(); file.set('file', new File([Buffer.from('%PDF-1.4 ' + status)], 'bill.pdf', { type: 'application/pdf' }));
      const response = await client.call('/api/scan', file); const result = await response.json();
      assert.equal(response.status, 200); assert.ok(result.document_id); assert.match(result.warning, expected);
      assert.ok(!JSON.stringify(result).includes('test-secret-key'));
    }
    assert.ok(logs.some(log => log.includes('404'))); assert.ok(!logs.join('').includes('test-secret-key'));
  } finally { globalThis.fetch = originalFetch; console.error = originalError; process.env.GEMINI_API_KEY = ''; }
});

test('non-ApiError failures retain diagnostics and do not blame receipt quality', async () => {
  const client = new Client(); await client.signup();
  process.env.GEMINI_API_KEY = 'test-secret-key';
  const originalFetch = globalThis.fetch, originalError = console.error;
  const logs: string[] = []; console.error = (...args: unknown[]) => logs.push(JSON.stringify(args));
  try {
    for (const [failure, expected] of [
      [Object.assign(new Error('wrapped provider error'), { status: 404 }), /model.*unavailable/i],
      [new Error('Request failed with test-secret-key'), /request failed/i],
    ] as const) {
      globalThis.fetch = async () => { throw failure; };
      const file = new FormData(); file.set('file', new File([Buffer.from('%PDF-1.4 diagnostic')], 'bill.pdf', { type: 'application/pdf' }));
      const result = await (await client.call('/api/scan', file)).json();
      assert.ok(result.document_id); assert.match(result.warning, expected); assert.doesNotMatch(result.warning, /clearer/);
    }
    assert.ok(logs.some(log => log.includes('Request failed with [redacted]')));
    assert.ok(!logs.join('').includes('test-secret-key'));
  } finally { globalThis.fetch = originalFetch; console.error = originalError; process.env.GEMINI_API_KEY = ''; }
});

test('receipt API uses cached rates, ignores supplied rates, and preserves saved conversions', async () => {
  const client = new Client(); await client.signup();
  assert.equal((await client.post({...record(),currency:'USD',rate:'1'})).status,400);
  const now = new Date().toISOString();
  for (const currency of ['USD','AED','GBP','EUR']) db.prepare('INSERT OR REPLACE INTO currency_cache(currency,rate_micros,fetched_at,source_updated_at) VALUES (?,?,?,?)').run(currency, currency === 'USD' ? 85_500_000 : 100_000_000, now, now);
  const receipt = { ...record(), currency:'USD', amount:'100', rate:'1' };
  assert.equal((await client.post(receipt)).status,200);
  let saved = (await (await client.call()).json()).receipts.find((r: {id:string}) => r.id === receipt.id);
  assert.equal(saved.rate_micros,85_500_000); assert.equal(saved.inr_minor,855000);
  db.prepare("UPDATE currency_cache SET rate_micros=90000000 WHERE currency='USD'").run();
  assert.equal((await client.post({...receipt,summary:'Updated note'})).status,200);
  saved = (await (await client.call()).json()).receipts.find((r: {id:string}) => r.id === receipt.id);
  assert.equal(saved.rate_micros,85_500_000);
  const report = {action:'closeReport',id:randomUUID(),ids:[receipt.id],name:'Cached FX'};
  assert.equal((await client.post(report)).status,200);
  assert.match(await (await client.call('/api/reports/'+report.id)).text(),/85.500000/);
  assert.equal((await client.post({...record(),currency:'CAD',rate:'60'})).status,400);
});

test('backup restores database and exact original document bytes', async () => {
  const destination = join(root,'backup');
  const previous = process.argv; process.argv = [process.execPath, 'scripts/backup.ts', destination];
  await import('../scripts/backup'); process.argv = previous;
  const { default: Database } = await import('better-sqlite3');
  const restored = new Database(join(destination,'billkeeper.sqlite'),{readonly:true});
  try {
    assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');
    assert.ok((restored.prepare('SELECT COUNT(*) AS n FROM users').get() as {n:number}).n >= 2);
    const doc = restored.prepare('SELECT storage_key FROM documents LIMIT 1').get() as {storage_key:string};
    assert.equal(readFileSync(join(destination,'documents',doc.storage_key)).toString(),'%PDF-1.4\n%%EOF');
  } finally { restored.close(); }
});
