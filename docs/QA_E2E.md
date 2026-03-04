# E2E Testing (Planlux Hale)

Automated end-to-end tests for the Electron app using Playwright. All E2E runs use an **isolated temp directory** (no production data).

## Prerequisites

- Node 20.19+
- Built desktop app: run `npm run build` from repo root (or `npm run build -w packages/desktop`) before E2E.

## Running E2E locally

```bash
# From repo root (recommended)
npm run build
npm run test:e2e -w packages/desktop

# Or from packages/desktop (after npm run build from root)
cd packages/desktop && npm run test:e2e
```

- **Headed (see browser):** `npm run test:e2e:headed -w packages/desktop`
- **View last HTML report:** `npm run test:e2e:report -w packages/desktop`

## Environment flags (E2E mode)

| Variable           | Description |
|--------------------|-------------|
| `PLANLUX_E2E=1`    | Enables E2E mode (isolated DB + PDF dir). |
| `PLANLUX_E2E_DIR`  | Absolute path to temp dir (created by tests). Must be set when `PLANLUX_E2E=1`. |
| `PLANLUX_E2E_SEED=1` | Optional; seeding is automatic when DB is empty. |

When **not** in E2E mode, production behavior is unchanged.

## What is covered

1. **Admin – users list**  
   Login as admin, open Admin panel, assert users table shows seeded users (admin@planlux.test, handlowiec1@planlux.test).

2. **Admin – history tabs**  
   Login as admin, open Historia PDF and Historia e-mail tabs; assert no crash (table or empty state visible).

3. **Salesperson – PDF**  
   Login as handlowiec, fill Kalkulator (client, hall dimensions), click “Generuj PDF”, assert PDF file appears under `E2E_DIR/pdfs` and size &gt; 20KB.  
   *Requires pricing cache (e.g. run app once with sync, or seed pricing for fresh E2E DB).*

4. **Salesperson – send email (safe)**  
   Login as handlowiec, click “Wyślij e-mail”, fill to/subject/body, send. Assert status message appears; no real SMTP, app must not crash.

## Seeded E2E users (when DB is empty)

| Email                     | Password  | Role       |
|---------------------------|-----------|------------|
| admin@planlux.test        | Admin123! | ADMIN      |
| handlowiec1@planlux.test  | Test123!  | HANDLOWIEC |

## Playwright report and artifacts

- **Report:** `packages/desktop/playwright-report/` (open with `npm run test:e2e:report -w packages/desktop`).
- **Traces / screenshots / videos:** `packages/desktop/test-results/` (retained on failure per config).

In CI, these are uploaded as artifacts.

## Troubleshooting

- **Login fails in E2E (nav never appears):** Ensure the app was built (`npm run build`) and that E2E seed ran (check for `[E2E] seed users created` in logs). Use `test:e2e:headed` and inspect the login screen.
- **Desktop unit tests fail (better-sqlite3 NODE_MODULE_VERSION):** Run `npm rebuild better-sqlite3` or use the Node version that matches the compiled module (e.g. Node 20.19+).
- **Playwright spawn EPERM:** Run E2E outside sandboxed environments (e.g. local terminal, CI with full permissions).
