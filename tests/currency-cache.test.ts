import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(),'billkeeper-fx-')), 'test.sqlite');
const { default: db, currencyCache } = await import('../lib/db');
const { refreshCurrencyCache } = await import('../lib/currency-cache');
const start = Date.now();
const feed = (now: number) => ({ result:'success', base_code:'USD', time_last_update_unix:Math.floor(now/1000), rates:{USD:1,INR:90,AED:3.6,GBP:0.75,EUR:0.9,CAD:1.3} });

test('one feed caches only the four currencies, inverts cross rates, and deduplicates concurrent/daily requests', async () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async (url) => { requests++; assert.equal(url,'https://open.er-api.com/v6/latest/USD'); return Response.json(feed(start)); };
  try {
    await Promise.all([refreshCurrencyCache(start),refreshCurrencyCache(start)]);
    const cache = currencyCache();
    assert.deepEqual(cache.rates.map(r => r.currency),['USD','AED','GBP','EUR']);
    assert.deepEqual(cache.rates.map(r => r.rate_micros),[90_000_000,25_000_000,120_000_000,100_000_000]);
    assert.equal(cache.rates[0].fetched_at,new Date(start).toISOString()); assert.equal(cache.last_error,null);
    await refreshCurrencyCache(start+23*3_600_000); assert.equal(requests,1);
    await refreshCurrencyCache(start+86_400_000); assert.equal(requests,2);
  } finally { globalThis.fetch = original; }
});

test('invalid or unavailable feeds retain all previous rates and retry no more than hourly', async () => {
  const original = globalThis.fetch; let requests = 0;
  const before = currencyCache().rates;
  const due = start+2*86_400_000;
  globalThis.fetch = async () => { requests++; return Response.json({ ...feed(due), rates: { USD:1, INR:90, GBP:0.75, EUR:0.9 } }); };
  try {
    await refreshCurrencyCache(due);
    assert.deepEqual(currencyCache().rates,before); assert.match(currencyCache().last_error!,/Could not refresh/);
    await refreshCurrencyCache(due+1000); assert.equal(requests,1);
    globalThis.fetch = async () => { requests++; throw new Error('Offline'); };
    await refreshCurrencyCache(due+3_600_000); assert.equal(requests,2); assert.deepEqual(currencyCache().rates,before);
    globalThis.fetch = async () => Response.json(feed(due+2*3_600_000));
    await refreshCurrencyCache(due+2*3_600_000); assert.equal(currencyCache().last_error,null);
    assert.equal(currencyCache().rates[0].fetched_at,new Date(due+2*3_600_000).toISOString());
  } finally { globalThis.fetch = original; }
});

test('wrong base, negative rates, future timestamps and provider errors cannot poison the cache', async () => {
  const original = globalThis.fetch;
  const before = currencyCache().rates;
  let due=start+3*86_400_000;
  try {
    for (const payload of [
      {...feed(due),base_code:'INR'},
      {...feed(due),rates:{...feed(due).rates,INR:-1}},
      {...feed(due),time_last_update_unix:Math.floor((due+5*86_400_000)/1000)},
      {...feed(due),result:'error'},
    ]) {
      globalThis.fetch = async () => Response.json(payload);
      await refreshCurrencyCache(due); due+=3_600_000;
      assert.deepEqual(currencyCache().rates,before);
    }
  } finally { globalThis.fetch = original; }
});
