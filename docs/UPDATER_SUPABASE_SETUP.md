# Planlux Hale — Supabase setup for the updater

This document describes how to configure Supabase as the update control backend for the Planlux Hale desktop app. The Electron updater module (`packages/desktop/electron/updates`) uses the `app_releases` table and Supabase Storage for installer files.

---

## 1. Purpose of the `app_releases` table

The `app_releases` table is the **single source of truth** for available desktop updates. The app:

1. On startup (and when the user checks for updates), queries Supabase for the **latest active stable release**.
2. Compares the release `version` with the current app version.
3. If a newer version exists, the UI can offer to download the installer.
4. The installer is downloaded from the URL in `download_url` (typically a Supabase Storage URL), then verified with `sha256` before running.

No application logic is changed by this doc; this is configuration and schema only.

---

## 2. Required fields

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | uuid | PK | Auto-generated. |
| `version` | text | Yes | Semantic version (e.g. `1.0.9`). Used for comparison and display. |
| `title` | text | No | Short title for the release. |
| `changelog` | text | No | Release notes or changelog text. |
| `download_url` | text | Yes | Full URL to the installer file (e.g. Supabase Storage public or signed URL). |
| `sha256` | text | Yes | SHA256 hash of the installer file (hex, lowercase recommended). |
| `mandatory` | boolean | No | Default `false`. Can be used by the app to force update. |
| `min_supported_version` | text | No | Oldest app version that can receive this update. |
| `rollout_percent` | integer | No | Default `100`. For gradual rollouts (0–100). |
| `active` | boolean | No | Default `true`. Only rows with `active = true` are considered. |
| `channel` | text | No | Default `'stable'`. Release channel (e.g. `stable`, `beta`). |
| `created_at` | timestamptz | No | Auto-set on insert. |

The updater **requires** at least: `version`, `download_url`, `sha256`. Other fields are optional but recommended.

---

## 3. How releases are selected by the app

The updater runs a single query to get the **latest** release:

- **Filters:** `active = true` AND `channel = 'stable'`
- **Order:** `version` DESC (highest version first)
- **Limit:** 1

So the app always gets the newest active stable release. Version comparison is done in the app (e.g. `1.2.0` > `1.1.9`). The table does not need to be ordered by semantic version in the database; the app compares versions after fetching.

---

## 4. Supabase Storage bucket for installers

### Bucket name

Use a bucket named **`updates`** (or ensure `download_url` in `app_releases` points to your chosen bucket/path).

### Recommended structure

Store installers under a clear path, for example:

```
updates/
  stable/
    Planlux-Hale-1.0.9.exe
    Planlux-Hale-1.1.0.exe
```

You can also use a flat structure (e.g. `updates/Planlux-Hale-1.0.9.exe`) if you prefer. The updater does not assume a folder layout; it **downloads from the URL stored in `download_url`**. So:

- Create the bucket (e.g. `updates`).
- Upload the `.exe` file.
- Make the file **public** or create a **signed URL** for temporary access.
- Put that URL in `app_releases.download_url` when inserting a release.

If the bucket is private, use Supabase Storage signed URLs (e.g. via Edge Function or backend) and set `download_url` to the signed URL, or use a public bucket for installers if acceptable for your security policy.

---

## 5. How to compute SHA256

Compute the SHA256 hash of the **installer file** (the exact bytes users will download), in **hex** format. Prefer **lowercase** for consistency.

**PowerShell (Windows):**

```powershell
Get-FileHash -Path ".\Planlux-Hale-1.0.9.exe" -Algorithm SHA256 | Select-Object -ExpandProperty Hash
```

Then convert to lowercase if needed (e.g. `$hash.ToLower()`).

**Node.js:**

```js
const fs = require('fs');
const crypto = require('crypto');
const buf = fs.readFileSync('Planlux-Hale-1.0.9.exe');
const sha256 = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
console.log(sha256);
```

Use this value in the `sha256` column. The updater verifies the downloaded file against this value and aborts if it does not match.

---

## 6. How to insert a release row

After the migration `20260306_create_app_releases.sql` has been applied and the installer is uploaded to Storage, insert a row:

```sql
INSERT INTO app_releases (
  version,
  title,
  changelog,
  download_url,
  sha256,
  mandatory,
  min_supported_version,
  rollout_percent,
  active,
  channel
) VALUES (
  '1.0.9',
  'Test update',
  'First updater test release',
  'https://storage-url/updates/planlux-hale-1.0.9.exe',
  'sha256_here',
  false,
  '1.0.8',
  100,
  true,
  'stable'
);
```

Replace:

- `version` — your release version.
- `title` / `changelog` — as desired.
- `download_url` — the actual URL of the installer (e.g. Supabase Storage URL: `https://<project_ref>.supabase.co/storage/v1/object/public/updates/stable/Planlux-Hale-1.0.9.exe`).
- `sha256_here` — the hex SHA256 of the installer file (lowercase).
- `min_supported_version` — optional; leave or set to the minimum app version that can install this update.

Only one row per `version`/channel is needed; the app selects the latest by `version DESC`. To “unpublish” a release, set `active = false` (do not delete if you need history).

---

## 7. Summary

| Step | Action |
|------|--------|
| 1 | Apply migration `supabase/migrations/20260306_create_app_releases.sql`. |
| 2 | Create Storage bucket `updates` and (optionally) folder `stable/`. |
| 3 | Build the installer, upload to Storage, set file public or use signed URL. |
| 4 | Compute SHA256 of the installer file (hex, lowercase). |
| 5 | Insert (or update) a row in `app_releases` with `version`, `download_url`, `sha256`, and `active = true`, `channel = 'stable'`. |

The desktop app will then see the new release when it checks for updates and will download from `download_url` and verify with `sha256`.
