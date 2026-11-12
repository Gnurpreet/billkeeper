export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { refreshCurrencyCache } = await import('./lib/currency-cache');
    const refresh = () => refreshCurrencyCache().catch(() => console.error('[currency] Cache refresh could not run.'));
    void refresh();
    setInterval(() => void refresh(), 3_600_000).unref();
  }
}
