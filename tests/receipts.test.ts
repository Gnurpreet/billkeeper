import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReceipt, reportCsv, csvCell } from '../lib/receipts';
import { validateFile } from '../lib/storage';
const valid = { vendor: 'Cafe', date: '2026-11-12', category: 'meals', currency: 'INR', amount: '123.45', summary: 'Lunch' };
test('INR uses integer minor units; foreign exchange rounds once to paise', () => {
  assert.equal(validateReceipt(valid).amount_minor, 12345);
  assert.equal(validateReceipt(valid).inr_minor, 12345);
  assert.equal(validateReceipt({ ...valid, currency: 'USD', amount: '10.01' }, 83_500_000).inr_minor, 83584);
  assert.equal(validateReceipt({ ...valid, currency: 'AED', amount: '1000' }, 22_750_000).inr_minor, 2275000);
  assert.throws(() => validateReceipt({ ...valid, currency: 'JPY', amount: '1000.5', rate: '0.56' }));
});
test('rejects guessed, malformed and out-of-range money and dates', () => {
  for (const amount of ['0', '-1', '1e3', 'NaN', '1.001', '', 4, '9999999999999999999']) assert.throws(() => validateReceipt({ ...valid, amount }));
  for (const date of ['2026-02-30', '2026-13-01', 'not-a-date', '']) assert.throws(() => validateReceipt({ ...valid, date }));
  assert.throws(() => validateReceipt({ ...valid, currency: 'XYZ' }));
  assert.throws(() => validateReceipt({ ...valid, category: 'unknown' }));
  assert.throws(() => validateReceipt({ ...valid, currency: 'USD' }));
  assert.throws(() => validateReceipt({ ...valid, summary: 'x'.repeat(2001) }));
});
test('CSV escapes quotes, newlines and spreadsheet formula injection', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell(' =HYPERLINK("bad")'), '"\' =HYPERLINK(""bad"")"');
  const csv = reportCsv({ id: 'r', name: 'Visit', count: 0, closed_at: '', total_inr_minor: 12345 }, []);
  assert.match(csv, /123.45/); assert.ok(csv.startsWith('\uFEFF'));
});
test('file validation checks bytes as well as declared MIME', () => {
  validateFile(Buffer.from('%PDF-1.4\n'), 'application/pdf');
  assert.throws(() => validateFile(Buffer.from('<script>alert(1)</script>'), 'image/jpeg'));
  assert.throws(() => validateFile(Buffer.alloc(0), 'application/pdf'));
  assert.throws(() => validateFile(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf'));
  assert.throws(() => validateFile(Buffer.from('%PDF-1.4'), 'text/html'));
});
