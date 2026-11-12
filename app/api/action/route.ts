import { after, NextRequest, NextResponse } from 'next/server';
import db, { snapshot } from '@/lib/db';
import { currentUser, endSession, hashPassword, requestPasswordReset, resetPassword, startSession, verifyPassword } from '@/lib/auth';
import { error, sameOrigin, readBody } from '@/lib/http';
import { currencies, validateReceipt } from '@/lib/receipts';
import { refreshCurrencyCache } from '@/lib/currency-cache';
import { closeReport } from '@/lib/reports';
export const runtime = 'nodejs';
export async function GET() {
  const user = await currentUser();
  if (!user) return error('Sign in to continue.', 401);
  await refreshCurrencyCache();
  return NextResponse.json(snapshot(user));
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return error('Invalid origin.', 403);
  if (Number(request.headers.get('content-length')) > 128_000) return error('Request is too large.', 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse((await readBody(request, 128_000)).toString()); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); } catch { return error('Invalid request.'); }
  const action = body.action;
  try {
    if (action === 'forgotPassword') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return error('Enter a valid email.');
      if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.APP_URL) return error('Password recovery is not configured. Contact the app owner.', 503);
      after(async () => { try { await requestPasswordReset(email); } catch { console.error('Password recovery email failed. Check email configuration.'); } });
      return NextResponse.json({ message: 'If this account exists, a reset link will arrive by email.' });
    }
    if (action === 'resetPassword') {
      if (!resetPassword(body.token, body.password)) return error('Reset link is invalid or expired. Request another link.');
      return NextResponse.json({ ok: true });
    }
    if (action === 'signup' || action === 'login') {
      const email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 10 || password.length > 128) return error('Enter a valid email and a password of 10–128 characters.');
      const attempts = db.prepare('SELECT attempts,first_at FROM login_attempts WHERE email = ?').get(email) as { attempts: number; first_at: number } | undefined;
      if (attempts && attempts.attempts >= 5 && Date.now() - attempts.first_at < 900_000) return error('Too many attempts. Try again in 15 minutes.', 429);
      let user = db.prepare('SELECT id,password_hash FROM users WHERE email = ?').get(email) as { id: number; password_hash: string } | undefined;
      if (action === 'signup') {
        if (user) return error('An account with this email already exists.');
        const row = db.prepare('INSERT INTO users(email,password_hash) VALUES (?,?)').run(email, hashPassword(password));
        user = { id: Number(row.lastInsertRowid), password_hash: '' };
      } else if (!user || !verifyPassword(password, user.password_hash)) {
        const now = Date.now();
        db.prepare(`INSERT INTO login_attempts(email,attempts,first_at) VALUES (?,1,?) ON CONFLICT(email) DO UPDATE SET attempts=CASE WHEN ?-first_at>900000 THEN 1 ELSE attempts+1 END,first_at=CASE WHEN ?-first_at>900000 THEN ? ELSE first_at END`).run(email, now, now, now, now);
        return error('Email or password is incorrect.', 401);
      }
      db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
      await startSession(user.id);
      return NextResponse.json({ ok: true });
    }
    const user = await currentUser();
    if (!user) return error('Sign in to continue.', 401);
    if (action === 'logout') { await endSession(); return NextResponse.json({ ok: true }); }
    if (action === 'saveReceipt') {
      const id = String(body.id || '');
      if (!/^[a-f0-9-]{36}$/.test(id)) return error('Invalid receipt request.');
      const existing = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as { user_id: number; report_id: string | null; document_id: string | null; currency: string; rate_micros: number } | undefined;
      if (existing && (existing.user_id !== user.id || existing.report_id)) return error('This receipt is unavailable or belongs to a closed report.', 409);
      if (!(currencies as readonly string[]).includes(String(body.currency))) return error('Choose a supported currency.');
      let rate: number | undefined;
      if (body.currency !== 'INR') {
        if (existing && existing.currency === body.currency) rate = existing.rate_micros;
        else {
          await refreshCurrencyCache();
          rate = (db.prepare('SELECT rate_micros FROM currency_cache WHERE currency=?').get(String(body.currency)) as { rate_micros: number } | undefined)?.rate_micros;
        }
      }
      const values = validateReceipt(body, rate);
      const documentId = body.document_id || null;
      if (documentId && (typeof documentId !== 'string' || !db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?').get(documentId, user.id))) return error('Document is unavailable.');
      if (documentId && db.prepare('SELECT id FROM receipts WHERE document_id = ? AND id != ?').get(documentId, id)) return error('This document already has a saved receipt.', 409);
      const latest = db.prepare('SELECT user_id,report_id FROM receipts WHERE id=?').get(id) as { user_id: number; report_id: string | null } | undefined;
      if (latest && (latest.user_id !== user.id || latest.report_id)) return error('This receipt is unavailable or belongs to a closed report.', 409);
      const params = [values.vendor, values.date, values.category, values.currency, values.amount_minor, values.rate_micros, values.inr_minor, values.summary, documentId];
      if (latest) db.prepare('UPDATE receipts SET vendor=?,date=?,category=?,currency=?,amount_minor=?,rate_micros=?,inr_minor=?,summary=?,document_id=? WHERE id=? AND user_id=? AND report_id IS NULL').run(...params, id, user.id);
      else db.prepare('INSERT INTO receipts(vendor,date,category,currency,amount_minor,rate_micros,inr_minor,summary,document_id,id,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...params, id, user.id);
    } else if (action === 'deleteReceipt') {
      const result = db.prepare('DELETE FROM receipts WHERE id=? AND user_id=? AND report_id IS NULL').run(String(body.id), user.id);
      if (!result.changes) return error('Draft receipt is unavailable.', 404);
    } else if (action === 'closeReport') {
      closeReport(user.id, body.name, body.ids, body.id);
    } else if (action === 'deleteReport') {
      db.transaction(() => {
        if (!db.prepare('SELECT id FROM reports WHERE id=? AND user_id=?').get(String(body.id), user.id)) throw new Error('Report is unavailable.');
        db.prepare('DELETE FROM receipts WHERE report_id=? AND user_id=?').run(String(body.id), user.id);
        db.prepare('DELETE FROM reports WHERE id=? AND user_id=?').run(String(body.id), user.id);
      })();
    } else return error('Unknown action.');
    return NextResponse.json(snapshot(user));
  } catch (cause) {
    if (cause instanceof Error && !('code' in cause)) return error(cause.message);
    console.error('Billkeeper action failed:', cause instanceof Error ? cause.name : 'Unknown error');
    return error('Could not save this change. Refresh and try again.', 500);
  }
}
