import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'billkeeper-unit-')), 'test.sqlite');
const { default: db } = await import('../lib/db');
const { closeReport } = await import('../lib/reports');
const a = Number(db.prepare('INSERT INTO users(email,password_hash) VALUES (?,?)').run('a@example.com','test').lastInsertRowid);
const b = Number(db.prepare('INSERT INTO users(email,password_hash) VALUES (?,?)').run('b@example.com','test').lastInsertRowid);
function receipt(user: number, value: number) { const id = randomUUID(); db.prepare('INSERT INTO receipts(id,user_id,vendor,date,category,currency,amount_minor,rate_micros,inr_minor,summary) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,user,'Shop','2026-11-12','meals','INR',value,1000000,value,''); return id; }
test('closing computes totals on server and retries return the same report', () => {
  const ids = [receipt(a, 101),receipt(a,202)], id = randomUUID();
  closeReport(a,'Trip',ids,id); closeReport(a,'Trip',ids,id);
  assert.equal((db.prepare('SELECT total_inr_minor FROM reports WHERE id=?').get(id) as { total_inr_minor: number }).total_inr_minor,303);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM receipts WHERE report_id=?').get(id) as { n: number }).n,2);
  assert.throws(() => closeReport(b,'Stolen',ids,id));
});
test('cross-account and stale receipt selection roll back the whole report', () => {
  const mine = receipt(a,400), theirs = receipt(b,500), id = randomUUID();
  assert.throws(() => closeReport(a,'Bad',[mine,theirs],id));
  assert.equal(db.prepare('SELECT id FROM reports WHERE id=?').get(id),undefined);
  assert.equal((db.prepare('SELECT report_id FROM receipts WHERE id=?').get(mine) as { report_id: unknown }).report_id,null);
  assert.throws(() => closeReport(a,'Bad',[mine,mine],randomUUID()));
  assert.throws(() => closeReport(a,'',[],randomUUID()));
});
