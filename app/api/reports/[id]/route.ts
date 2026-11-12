import { NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import db from '@/lib/db';
import { error } from '@/lib/http';
import { reportCsv, type Report, type Receipt } from '@/lib/receipts';
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return error('Sign in to continue.', 401);
  const { id } = await context.params;
  const report = db.prepare('SELECT * FROM reports WHERE id=? AND user_id=?').get(id, user.id) as Report | undefined;
  if (!report) return error('Report not found.', 404);
  const receipts = db.prepare('SELECT * FROM receipts WHERE report_id=? AND user_id=? ORDER BY date,vendor').all(id, user.id) as Receipt[];
  return new Response(reportCsv(report, receipts), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="billkeeper-${id}.csv"`, 'Cache-Control': 'private, no-store' } });
}
