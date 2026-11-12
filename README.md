# Billkeeper

A private receipt book for Android and desktop, built with the same Next.js, SQLite, cookie-session and PM2/Nginx pattern as Timekeeper. One app and one database serve both the browser and installed PWA.

## Start locally

Requires Node.js 22.22+ and npm. Native SQLite installation may need Python 3, make and a C++ compiler.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://localhost:3026** and create an account. Separate accounts have separate receipts, reports and documents; these are not Timekeeper accounts. The development server listens on all interfaces so you can also test the layout over your local network.

Manual entry, document uploads, review, editing, reporting and CSV work without API keys. The ignored `data/` directory holds the database and private documents. Do not delete it between runs. `.env.local` is ignored too; never commit credentials or real receipts.

Set `GEMINI_API_KEY` to enable image/PDF extraction, then restart. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`; select a model available to your Google project. Documents are sent to Google only when AI scanning is enabled. Verify extracted fields before saving. No result is saved as an expense automatically. Missing fields remain empty for review.

Supported uploads: JPEG, PNG, WebP and PDF, up to 10 MB each. Multiple uploads are processed one at a time with a review between files. Use **Skip this file** to advance or **Stop after this receipt** to discard the remaining queue. A failed upload keeps the file selected while the page remains open. A failed AI scan preserves the private uploaded document for manual entry. Identical document bytes cannot create duplicate receipts within an account. Limits: 200 new documents/day and 60 AI attempts/hour per account.

Foreign receipts keep their original amount and an automatically selected cached INR-per-unit rate (six decimal places). Supported currencies are **INR, USD, AED, GBP and EUR**. Reports sum rounded INR amounts; they never sum unlike currencies. Original amounts use integer minor units and conversions use integer arithmetic. A saved receipt keeps its rate when edited in the same currency; changing its currency selects the current cached rate. Closed reports and their receipt details are immutable. Deleting a report explicitly deletes its receipts; export a copy first. Existing receipts in previously supported currencies remain readable and exportable; choose a supported currency to edit such a draft.

## Daily currency cache

Billkeeper uses [ExchangeRate-API's open access endpoint](https://www.exchangerate-api.com/docs/free). It is free, needs no API key and permits caching. XE's API is a trial/paid service, so no XE credentials are needed. Attribution appears in the app footer and Settings.

A single USD-based request supplies INR and the four foreign currencies. The server calculates INR per unit as `feed.INR / feed[currency]` and stores **only USD, AED, GBP and EUR** in SQLite's `currency_cache` table, with `fetched_at` and `source_updated_at`. INR is always 1:1. Settings → **Currency rates** shows each rate, the last successful fetch, the provider's rate date, and any stale/error state.

The Next.js server starts a background check at startup and every hour, including while the app is idle. A successful cache lasts 24 hours; checks in that period make no provider request. Authenticated app loads and new foreign receipt saves also check freshness. A SQLite claim prevents overlapping checks from fetching twice. Failed requests retain the entire last good cache and retry no more than hourly, rather than hammering the provider. **Check rates** in Settings checks the cache; it does not bypass these intervals.

If no successful fetch exists, INR receipts still work, while new foreign receipts cannot save until rates are available. Stale rates remain usable with a visible warning. Rates are daily reference rates at the time of saving, not historical rates for the receipt date or bank/card settlement rates. Refreshes do not recalculate saved receipts or closed reports. No manual exchange-rate override is accepted by the receipt API.

No new dependency, API key, cron job or PM2 worker is required. The scheduler runs only while the Node server is running and resumes on startup. Builds skip the scheduler. The cache is included in ordinary SQLite backups.

## Test the production build

```bash
npm run check
npm test
npm run build
npm start
```

`npm start` serves the production app on **http://localhost:3026**. Set `APP_URL=http://localhost:3026` for local testing, including production mode; this permits the session cookie over local HTTP. Production deployment must use `APP_URL=https://billkeeper.spurline.in` so the cookie is secure.

Development and production builds use separate `.next-dev/` and `.next/` directories. Stop one server before starting the other on port 3026. Service workers are registered only by production builds.

Run the browser suite after building, with port 3036 free:

```bash
npx playwright install chromium
npm run test:e2e
```

The suite launches a production server with a disposable database and document directory under `/tmp`, without external integrations. It checks desktop/mobile workflows, authentication, ownership, documents, report locking, CSV and offline fallback. Screenshots are saved under ignored `test-results/`. `CHROMIUM_PATH=/path/to/chrome npm run test:e2e` can use an existing Chromium.

The unit/API tests run without a listening server. They exercise real handlers inside Next request contexts, money, dates, file validation, transaction rollback, cookie sessions, ownership, duplicate saves, report locking, CSV, password-reset expiry/session revocation, mocked Gemini success/failure, and a backup restoration. They do not call paid providers. The request-context harness uses the pinned Next.js version's internals and may need adjustment when upgrading Next.

## Android PWA testing without deployment

The production manifest has standalone display, 192/512px icons, a maskable icon, and a stable root ID. Chrome can install it directly; there is no Play Store package. Service-worker caches contain only the public offline page and icon, never receipts or authenticated responses.

For a real installation test from your development computer:

1. Enable Android developer options and USB debugging; connect the phone by USB.
2. With Android platform tools installed, run `adb reverse tcp:3026 tcp:3026`.
3. Run the production app locally (`npm run build`, then `npm start`).
4. Open `http://localhost:3026` in Chrome **on the phone**. Localhost qualifies as a secure context. A plain `http://192.168...` LAN address does not support a full installation/camera-permission test.
5. Sign in, open Chrome's menu and choose **Install app** (or **Add to Home screen**, depending on Chrome). Settings also offers an install button when Chrome exposes the installation prompt.
6. Launch from the icon; test camera capture, gallery selection, PDF selection, review, editing, foreign currency, closing a report, CSV download, logout and sign-in.
7. Disable connectivity: saving/scanning should be blocked or report a recoverable error. Reload should display the offline page. Reconnect and reload to return.
8. Leave a review open during an app update; it must not reload automatically. Service-worker updates activate after existing app windows close.

An existing development service worker or browser cache can affect tests. Use Chrome DevTools → Application → Service Workers to unregister it and Clear storage if testing with disposable data. Clearing browser storage does not delete saved server records, but it does lose an unsaved review. Unsaved files/reviews are held in memory, with a warning before leaving; offline queueing and background sync are not implemented.

## Optional private Hetzner storage

Leave all `HETZNER_OS_*` settings empty to use private files outside `public/`. To switch new documents to Hetzner, fill all five settings in `.env.local` and restart. Use a private bucket (no public-read bucket policy), scoped credentials and a separate Billkeeper prefix. The app sets no public ACL and serves documents only after account ownership checks. Existing local files remain local and still need backing up.

Do not reuse the prototype's publicly accessible object URLs as the new storage strategy. Bucket permissions must be verified with your credentials before production. Uploaded documents, including abandoned reviews and documents belonging to deleted receipts, are retained privately for now; monitor storage and add an explicit retention policy before high-volume use.

## Password recovery

Set `RESEND_API_KEY`, a verified `EMAIL_FROM` sender, and `APP_URL`. Password recovery emails a one-use link that expires in 30 minutes. Resetting a password invalidates all existing sessions. The API returns the same recovery confirmation for existing and unknown accounts. Without email settings, recovery is explicitly unavailable. Recovery delivery must be checked with your actual email account.

## Backups and restore

```bash
npm run backup
# Or specify a new, empty destination:
npm run backup -- /path/to/private-backup
```

This uses SQLite's backup API (including live WAL contents), verifies database integrity and copies all local documents recorded in that snapshot. Backups contain account hashes and private receipts; keep them private and off-server. With Hetzner configured and no remaining local documents, the database snapshot is also uploaded privately under `billkeeper/backups/`; immutable S3 documents remain in their existing bucket. Enable bucket protection/versioning separately if required. No automatic retention/deletion is applied.

For daily backups, schedule `cd /path/to/billkeeper && /absolute/path/to/npm run backup` through your server's existing scheduler, using the app owner's account and Node environment. Check the command succeeds and monitor disk usage. Deployment also takes a backup before building when a configured database exists.

To restore: stop Billkeeper, preserve the current database **and its WAL/SHM files** and documents as a separate recovery copy, copy the snapshot database into a fresh database path, and point `DOCUMENTS_PATH` to the snapshot's `documents/` directory. Start with these paths and verify login, counts, report totals, and opening originals. Never place an old snapshot next to a live database's WAL/SHM files. S3-backed records require the same private object storage configuration and original objects.

No legacy database was present in the downloaded AI Studio project. A production-data migration is therefore not run or guessed. Keep any existing prototype database and documents intact; migrating them will require reconciling old conversion totals and assigning receipt ownership.

## Later deployment — not performed

Use a separate clone on the existing Timekeeper server. Keep `.env.local`, the database and originals persistent, and set `APP_URL=https://billkeeper.spurline.in`. Verify port 3026 is free and that Node, npm, native build tools, PM2, Nginx and Certbot are available. Run `./deploy.sh` as the PM2 process owner. It updates code, installs dependencies, checks/tests, backs up existing data, builds and starts only `billkeeper` on `127.0.0.1:3026`.

Install `nginx.conf` as a separate virtual host for `billkeeper.spurline.in`; point DNS at the server, validate Nginx and issue the HTTPS certificate through the existing Certbot setup. Keep certificate and Nginx changes outside routine deployments. No Timekeeper process or configuration is modified.

If a release fails after replacing the PM2 process, check its logs, check out the previous known-good release, reinstall/build and restart Billkeeper. Keep the database unless a schema change explicitly requires restoring the matching backup. The script does not promise automatic rollback.
