import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const password = 'billkeeper-test-password';
async function signup(api: APIRequestContext) { const email = `${randomUUID()}@example.com`; const response = await api.post('/api/action', { data: { action: 'signup', email, password } }); expect(response.ok()).toBeTruthy(); return email; }
const receipt = () => ({ action: 'saveReceipt', id: randomUUID(), vendor: 'Test Cafe', date: '2026-11-12', category: 'meals', currency: 'INR', amount: '120.50', summary: 'Lunch' });

test('ownership, duplicate saves, private documents, locked reports, CSV and logout', async ({ playwright }) => {
  const a = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3036' });
  const b = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3036' });
  try {
    expect((await a.get('/api/action')).status()).toBe(401);
    await signup(a); await signup(b);
    expect((await a.post('/api/action', { headers: { Origin: 'https://evil.example' }, data: receipt() })).status()).toBe(403);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
    const uploaded = await a.post('/api/scan', { multipart: { file: { name: 'bill.pdf', mimeType: 'application/pdf', buffer: pdf } } });
    expect(uploaded.ok()).toBeTruthy(); const doc = await uploaded.json(); expect(doc.document_id).toBeTruthy(); expect(doc.warning).toMatch(/not configured/);
    const record = { ...receipt(), document_id: doc.document_id };
    expect((await a.post('/api/action', { data: record })).ok()).toBeTruthy();
    expect((await a.post('/api/action', { data: record })).ok()).toBeTruthy();
    expect((await b.get('/api/documents/' + doc.document_id)).status()).toBe(404);
    const document = await a.get('/api/documents/' + doc.document_id); expect(document.ok()).toBeTruthy(); expect(document.headers()['cache-control']).toContain('no-store');
    expect((await b.post('/api/action', { data: { ...record, vendor: 'Stolen' } })).status()).toBe(409);
    expect((await b.post('/api/action', { data: { action: 'deleteReceipt', id: record.id } })).status()).toBe(404);
    const state = await (await a.get('/api/action')).json(); expect(state.receipts).toHaveLength(1); expect(state.receipts[0].inr_minor).toBe(12050);
    const report = { action: 'closeReport', id: randomUUID(), name: 'Local test', ids: [record.id], total_inr_minor: 1 };
    expect((await a.post('/api/action', { data: report })).ok()).toBeTruthy(); expect((await a.post('/api/action', { data: report })).ok()).toBeTruthy();
    expect((await a.post('/api/action', { data: record })).status()).toBe(409);
    expect((await a.post('/api/action', { data: { action: 'deleteReceipt', id: record.id } })).status()).toBe(404);
    expect((await b.get('/api/reports/' + report.id)).status()).toBe(404);
    expect(await (await a.get('/api/reports/' + report.id)).text()).toContain('120.50');
    expect((await a.post('/api/action', { data: { action: 'deleteReport', id: report.id } })).ok()).toBeTruthy();
    expect((await (await a.get('/api/action')).json()).receipts).toHaveLength(0);
    expect((await a.post('/api/action', { data: { action: 'logout' } })).ok()).toBeTruthy();
    expect((await a.get('/api/documents/' + doc.document_id)).status()).toBe(401);
  } finally { await a.dispose(); await b.dispose(); }
});

for (const width of [390, 1440]) test(`complete manual workflow at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const email = `${randomUUID()}@example.com`;
  await page.goto('/'); await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Email address').fill(email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep the receipt.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add manually' }).click();
  await page.getByLabel('Merchant', { exact: true }).fill('Desktop & mobile cafe');
  await page.getByLabel('Receipt date').fill('2026-11-12'); await page.getByLabel('Category', { exact: true }).selectOption('meals'); await page.getByLabel('Original amount').fill('250.25');
  await page.getByRole('button', { name: 'Save to draft' }).click();
  await expect(page.getByRole('heading', { name: 'Your open draft.' })).toBeVisible(); await expect(page.getByText('Desktop & mobile cafe')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Desktop & mobile cafe' }).click(); await page.getByLabel('Original amount').fill('300.25'); await page.getByRole('button', { name: 'Save to draft' }).click();
  await page.getByRole('button', { name: 'Close this report' }).click(); await page.getByLabel('Report name').fill('November expenses'); await page.getByRole('button', { name: 'Close report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Filed & finished.' })).toBeVisible(); await page.getByRole('button', { name: 'Open report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'November expenses' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: `test-results/report-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Delete report and its receipts' }).click(); await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('heading', { name: 'A home for finished reports.' })).toBeVisible();
  await page.getByRole('navigation', { name: width < 800 ? 'Mobile navigation' : 'Main navigation', exact: true }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Currency rates', exact: true })).toBeVisible();
  await expect(page.getByText('Last successful fetch:', { exact: false })).toBeVisible();
  for (const currency of ['USD','AED','GBP','EUR']) await expect(page.locator('.currency-rates dt').getByText(currency, { exact: true })).toBeVisible();
});

test('PWA manifest, service worker, offline fallback and production file upload', async ({ page }) => {
  await signup(page.request); await page.goto('/');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json(); expect(manifest.display).toBe('standalone'); expect(manifest.icons).toHaveLength(3);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.getByLabel('Upload receipt documents').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64') });
  await expect(page.getByText('AI scanning is not configured. Enter the receipt details below.')).toBeVisible();
  await page.getByLabel('Merchant', { exact: true }).fill('Photo test'); await page.getByLabel('Receipt date').fill('2026-11-12'); await page.getByLabel('Category', { exact: true }).selectOption('meals'); await page.getByLabel('Original amount').fill('10'); await page.getByRole('button', { name: 'Save to draft' }).click();
  await expect(page.getByText('Photo test')).toBeVisible();
  await page.context().setOffline(true); await page.reload(); await expect(page.getByRole('heading', { name: /A little pause/ })).toBeVisible();
});

test('Already digital pane accepts dropped files and queues them for review', async ({ page }) => {
  await signup(page.request); await page.goto('/');
  const pane = page.locator('.upload-card');
  const files = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    for (const name of ['first.pdf', 'second.pdf']) transfer.items.add(new File(['%PDF-1.4\n%%EOF'], name, { type: 'application/pdf' }));
    return transfer;
  });
  await expect(pane).toBeVisible();
  await pane.dispatchEvent('dragover', { dataTransfer: files });
  await expect(pane).toHaveClass(/dragging/);
  await pane.getByRole('heading').dispatchEvent('dragleave', { relatedTarget: await pane.getByRole('button').elementHandle() });
  await expect(pane).toHaveClass(/dragging/);
  await pane.dispatchEvent('dragleave');
  await expect(pane).not.toHaveClass(/dragging/);
  await page.context().setOffline(true);
  await expect(pane.getByRole('button')).toBeDisabled();
  await pane.dispatchEvent('drop', { dataTransfer: files });
  await expect(pane).toBeVisible();
  await page.context().setOffline(false);
  await expect(pane.getByRole('button')).toBeEnabled();
  await pane.dispatchEvent('drop', { dataTransfer: files });
  await expect(page.getByRole('heading', { name: 'Check the details.' })).toBeVisible();
  await expect(page.getByText('1 more in queue', { exact: true })).toBeVisible();
  await expect(page.getByText('AI scanning is not configured. Enter the receipt details below.')).toBeVisible();
  await expect(page.locator('.section-caption')).toHaveText('first.pdf');
  await files.dispose();
});
