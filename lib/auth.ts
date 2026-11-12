import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import db, { type User } from './db';

const cookieName = 'billkeeper_session';
const thirtyDays = 30 * 24 * 60 * 60;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.email
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(hashToken(token), Date.now()) as User | undefined || null;
}

export async function startSession(userId: number) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, Date.now() + thirtyDays * 1000);
  (await cookies()).set(cookieName, token, { httpOnly: true, secure: process.env.APP_URL?.startsWith('https://') ?? process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: thirtyDays });
}

export async function endSession() {
  const token = (await cookies()).get(cookieName)?.value;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  (await cookies()).delete(cookieName);
}

export async function requestPasswordReset(email: string) {
  const { RESEND_API_KEY, EMAIL_FROM, APP_URL } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM || !APP_URL) throw new Error('Password reset email is not configured.');
  const url = new URL('/', APP_URL);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('APP_URL must use HTTPS.');
  const now = Date.now();
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const user = db.transaction(() => {
    db.prepare('DELETE FROM password_reset_requests WHERE requested_at < ?').run(now - 24 * 60 * 60_000);
    db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now);
    const recent = db.prepare('SELECT requested_at FROM password_reset_requests WHERE email = ?').get(email) as { requested_at: number } | undefined;
    if (recent && now - recent.requested_at < 60_000) return;
    db.prepare('INSERT OR REPLACE INTO password_reset_requests (email, requested_at) VALUES (?, ?)').run(email, now);
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined;
    if (user) db.prepare('INSERT OR REPLACE INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, user.id, now + 30 * 60_000);
    return user;
  })();
  if (!user) return;
  // Keep the token out of server logs and referrer headers.
  url.hash = `reset-password=${token}`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM, to: [email], subject: 'Reset your Billkeeper password',
        text: `Reset your Billkeeper password using this link:\n\n${url.href}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Password reset email could not be sent.');
  } catch {
    db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
    throw new Error('Password reset email could not be sent.');
  }
}

export function resetPassword(token: unknown, password: unknown) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw new Error('Choose a password between 10 and 128 characters.');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  return db.transaction(() => {
    const user = db.prepare('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), Date.now()) as { user_id: number } | undefined;
    if (!user) return false;
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.user_id);
    db.prepare('DELETE FROM login_attempts WHERE email = (SELECT email FROM users WHERE id = ?)').run(user.user_id);
    return true;
  })();
}
