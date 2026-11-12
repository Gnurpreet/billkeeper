import db, { currencyCache } from './db';
import { foreignCurrencies } from './receipts';

export async function refreshCurrencyCache(now = Date.now()) {
  // Claim the attempt before awaiting the provider, including across server processes.
  const claimed = db.transaction(() => {
    const cache = currencyCache();
    if (cache.rates.length === 4 && cache.rates.every(rate => now - Date.parse(rate.fetched_at) < 86_400_000)) return false;
    const state = db.prepare('SELECT last_attempt_at FROM currency_fetch_state WHERE id=1').get() as { last_attempt_at: number };
    if (now - state.last_attempt_at < 3_600_000) return false;
    db.prepare('UPDATE currency_fetch_state SET last_attempt_at=? WHERE id=1').run(now);
    return true;
  })();
  if (!claimed) return;
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!response.ok) throw new Error('Currency provider is unavailable.');
    const data = await response.json();
    const updated = data?.time_last_update_unix;
    if (data?.result !== 'success' || data.base_code !== 'USD' || !Number.isSafeInteger(updated) || updated <= 0 || updated * 1000 > now + 3_600_000 || now - updated * 1000 > 7 * 86_400_000 || data.rates?.USD !== 1) throw new Error('Currency provider returned invalid rates.');
    const inr = data.rates.INR;
    if (typeof inr !== 'number' || !Number.isFinite(inr) || inr <= 0) throw new Error('Currency provider returned invalid INR rate.');
    const rows = foreignCurrencies.map(currency => {
      const baseRate = data.rates[currency];
      if (typeof baseRate !== 'number' || !Number.isFinite(baseRate) || baseRate <= 0) throw new Error('Currency provider omitted a required rate.');
      // The feed is USD-based: INR per currency = INR per USD / currency per USD.
      const rate = Math.round(inr / baseRate * 1_000_000);
      if (!Number.isSafeInteger(rate) || rate <= 0 || rate > 1_000_000_000_000) throw new Error('Currency provider returned an invalid conversion.');
      return { currency, rate };
    });
    const sourceUpdated = new Date(updated * 1000).toISOString();
    const current = currencyCache().rates;
    if (current.some(rate => Date.parse(rate.source_updated_at) > updated * 1000)) throw new Error('Currency provider returned older rates.');
    db.transaction(() => {
      const save = db.prepare('INSERT INTO currency_cache(currency,rate_micros,fetched_at,source_updated_at) VALUES (?,?,?,?) ON CONFLICT(currency) DO UPDATE SET rate_micros=excluded.rate_micros,fetched_at=excluded.fetched_at,source_updated_at=excluded.source_updated_at');
      for (const row of rows) save.run(row.currency, row.rate, new Date(now).toISOString(), sourceUpdated);
      db.prepare('UPDATE currency_fetch_state SET last_error=NULL WHERE id=1').run();
    })();
  } catch {
    db.prepare('UPDATE currency_fetch_state SET last_error=? WHERE id=1').run('Could not refresh currency rates. Last good rates are retained; another attempt will run within an hour.');
    console.error('[currency] Refresh failed; keeping the last good rates.');
  }
}
