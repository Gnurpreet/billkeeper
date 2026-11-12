export const categories = ['travel', 'meals', 'stationery', 'equipment', 'IT cloud expenses', 'online tools'] as const;
export const foreignCurrencies = ['USD', 'AED', 'GBP', 'EUR'] as const;
export const currencies = ['INR', ...foreignCurrencies] as const;
export type CurrencyRate = { currency: string; rate_micros: number; fetched_at: string; source_updated_at: string };
export type CurrencyCache = { rates: CurrencyRate[]; last_error: string | null; stale: boolean };
export type Receipt = { id: string; vendor: string; date: string; category: string; currency: string; amount_minor: number; rate_micros: number; inr_minor: number; summary: string; document_id: string | null; report_id: string | null; document_mime?: string | null };
export type Report = { id: string; name: string; closed_at: string; total_inr_minor: number; count: number };
export type Snapshot = { user: { email: string }; receipts: Receipt[]; reports: Report[]; scanning: boolean; recovery: boolean; storage: string; currencyCache: CurrencyCache };
export function decimal(value: unknown, places: number, label: string) {
  if (typeof value !== 'string' || !new RegExp(`^\\d{1,10}${places ? `(?:\\.\\d{1,${places}})?` : ''}$`).test(value)) throw new Error(`Enter a valid ${label} with up to ${places} decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  const result = Number(BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0')));
  if (!Number.isSafeInteger(result) || result <= 0 || result > 1_000_000_000_000) throw new Error(`${label} is out of range.`);
  return result;
}
export function minorDigits(currency: string) { return currency === 'JPY' ? 0 : 2; }
export function amountText(minor: number, currency: string) { return (minor / 10 ** minorDigits(currency)).toFixed(minorDigits(currency)); }
export function money(minor: number, currency = 'INR') { return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 10 ** minorDigits(currency)); }
export function validateReceipt(body: Record<string, unknown>, cachedRateMicros?: number) {
  const vendor = typeof body.vendor === 'string' ? body.vendor.trim() : '';
  if (!vendor || vendor.length > 160) throw new Error('Enter a merchant name under 160 characters.');
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Enter a valid receipt date.');
  const currency = String(body.currency || '');
  if (!(currencies as readonly string[]).includes(currency)) throw new Error('Choose a supported currency.');
  const category = String(body.category || '');
  if (!(categories as readonly string[]).includes(category)) throw new Error('Choose a receipt category.');
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (summary.length > 2000) throw new Error('Keep the item summary under 2,000 characters.');
  const digits = minorDigits(currency);
  const amount_minor = decimal(body.amount, digits, 'amount');
  if (!Number.isSafeInteger(amount_minor)) throw new Error('Enter a whole amount for JPY.');
  const rate_micros = currency === 'INR' ? 1_000_000 : cachedRateMicros;
  if (!Number.isSafeInteger(rate_micros) || !rate_micros || rate_micros <= 0) throw new Error('No cached exchange rate is available. Check Currency rates in Settings and try again.');
  const denominator = 10n ** BigInt(digits) * 1_000_000n;
  const inr_minor = Number((BigInt(amount_minor) * BigInt(rate_micros) * 100n + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(inr_minor) || inr_minor > 1_000_000_000_000) throw new Error('Converted amount is out of range.');
  return { vendor, date, category, currency, summary, amount_minor, rate_micros, inr_minor };
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function reportCsv(report: Report, receipts: Receipt[]) {
  return '\uFEFF' + [
    ['Report', 'Date', 'Merchant', 'Category', 'Currency', 'Original amount', 'INR per unit', 'Amount INR', 'Items'],
    ...receipts.map(r => [report.name, r.date, r.vendor, r.category, r.currency, amountText(r.amount_minor, r.currency), (r.rate_micros / 1e6).toFixed(6), amountText(r.inr_minor, 'INR'), r.summary]),
    ['Total INR', '', '', '', '', '', '', amountText(report.total_inr_minor, 'INR'), ''],
  ].map(row => row.map(csvCell).join(',')).join('\r\n');
}
