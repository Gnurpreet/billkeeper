import db from './db';
export function closeReport(userId: number, name: unknown, ids: unknown, id: unknown) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error('Enter a report name under 120 characters.');
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid report request.');
  return db.transaction(() => {
    const previous = db.prepare('SELECT user_id FROM reports WHERE id = ?').get(id) as { user_id: number } | undefined;
    if (previous) { if (previous.user_id !== userId) throw new Error('Invalid report request.'); return id; }
    if (!Array.isArray(ids) || !ids.length || ids.length > 2000 || new Set(ids).size !== ids.length || ids.some(i => typeof i !== 'string')) throw new Error('Choose between 1 and 2,000 draft receipts.');
    let total = 0;
    for (const receiptId of ids) {
      const r = db.prepare('SELECT inr_minor FROM receipts WHERE id = ? AND user_id = ? AND report_id IS NULL').get(receiptId, userId) as { inr_minor: number } | undefined;
      if (!r) throw new Error('Some receipts changed. Refresh the draft and try again.');
      total += r.inr_minor;
    }
    if (!Number.isSafeInteger(total)) throw new Error('Report total is out of range.');
    db.prepare('INSERT INTO reports (id,user_id,name,total_inr_minor) VALUES (?,?,?,?)').run(id, userId, name.trim(), total);
    const update = db.prepare('UPDATE receipts SET report_id = ? WHERE id = ? AND user_id = ? AND report_id IS NULL');
    for (const receiptId of ids) update.run(id, receiptId, userId);
    return id;
  })();
}
