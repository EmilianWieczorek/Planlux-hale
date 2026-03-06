# Production Fix Report: Auth/Role, Admin UI, PDF, Repair Tooling

## 1. Modified Files

| File | Changes |
|------|--------|
| `packages/shared/src/rbac.ts` | Explicit SALES→HANDLOWIEC in `normalizeRole`; central role mapping comment |
| `packages/desktop/electron/auth/authSupabase.ts` | Use `normalizeRoleRbac` from shared; fallback logs; `getProfileRoleByUserId()` |
| `packages/desktop/electron/auth/login.ts` | Use `normalizeRoleRbac` from shared (remove local `normalizeRole`) |
| `packages/desktop/electron/auth/session.ts` | `updateCurrentSessionUser({ role?, displayName? })` for in-place role refresh |
| `packages/desktop/electron/ipc.ts` | `normalizeRole` delegates to shared; `hydrateEffectiveCurrentUser()`; login flow repair + logs; `planlux:session` refresh; PDF validation/stage/DIAGNOSTYKA/persistence failure handling; `planlux:auth:debugCurrentUser` and `planlux:auth:repairCurrentUserRole` |
| `packages/desktop/electron/pdf/pdfPaths.ts` | `getPdfTemplateDirCandidates()` for DIAGNOSTYKA |
| `packages/desktop/electron/preload.ts` | Allowlist `planlux:auth:debugCurrentUser`, `planlux:auth:repairCurrentUserRole` |
| `packages/desktop/renderer/src/features/layout/MainLayout.tsx` | Single role source: `isBossOrAdmin = canAccessAdmin` |

---

## 2. Root Causes Fixed

- **Admin role not recognized**: Session role was set once at login from local SQLite; if local `users.role` was stale (e.g. HANDLOWIEC while Supabase `profiles.role` = ADMIN), session and renderer stayed wrong. **Fix**: After Supabase login we sync, then **self-heal**: if Supabase says ADMIN and local does not, we update local to ADMIN and use ADMIN for session. On `planlux:session` we optionally refresh role from Supabase and update the in-memory session.
- **Stale local roles overriding Supabase**: **Fix**: `hydrateEffectiveCurrentUser()` compares Supabase profile role with local `users.role`; on mismatch it updates local DB and returns the effective role. Used after login and on session restore.
- **Session role fixed at login**: **Fix**: `planlux:session` now runs a refresh when Supabase is available: fetches profile role, repairs local if needed, and updates session via `updateCurrentSessionUser({ role })`, so the returned session has the correct role.
- **Admin UI hidden despite Supabase ADMIN**: **Fix**: Login flow repair (Supabase ADMIN → update local to ADMIN) and session refresh ensure `user.role` in the renderer is ADMIN when Supabase says ADMIN. MainLayout uses a single source: `canAccessAdminPanel(user.role)` and `isBossOrAdmin = canAccessAdmin`.
- **PDF unstable / lacking diagnostics**: **Fix**: Strict payload validation with explicit missing-fields list; DIAGNOSTYKA with `appPath`, `resourcesPath`, `cwd`, `isPackaged`, `attemptedTemplatePaths`; post-generation file-exists check; persistence failures no longer hide the generated file (return `ok: true` with `stage: 'PERSISTENCE_FAILED'` and `persistenceError`); types include `details`, `stage`, `missingFields`.

---

## 3. Code Changes (Summary)

### Role normalization (central)

- **shared/rbac.ts**: `normalizeRole()` documents and applies SALES→HANDLOWIEC, MANAGER→SZEF, ADMIN→ADMIN. No behavior change for existing inputs.
- **authSupabase.ts**: Uses `normalizeRoleRbac` from `@planlux/shared`; profile fetch failure/null fallback logs mention “fallback to HANDLOWIEC” and “profile returned null” / “profile fetch failed”.
- **login.ts**: Local `normalizeRole` removed; uses `normalizeRoleRbac` from shared.
- **ipc.ts**: `normalizeRole()` kept as a thin wrapper calling `normalizeRoleRbac(input)` for AllowedRole typing.

### Self-healing and session

- **session.ts**: `updateCurrentSessionUser(updates: { role?: string; displayName?: string | null })` updates the current session in the map.
- **ipc.ts**:
  - `hydrateEffectiveCurrentUser(userId, email)`: reads local user, optionally fetches Supabase profile via `getProfileRoleByUserId`, if roles differ updates local `users.role`, logs `[auth] repairing local role from X to Y`, returns `{ user, effectiveRole, repaired, roleFromSupabase, roleFromLocalBefore }`.
  - **Login (online Supabase)**: After `syncUsersFromBackend()`, log `[auth] role from local DB before repair`. If `result.user.role === 'ADMIN'` and local role ≠ ADMIN, run `UPDATE users SET role = 'ADMIN' WHERE email = ?`, log repair, re-read local, log `[auth] role from local DB after repair`. Session is created with the final normalized role from local (after sync + repair).
  - **planlux:session**: If session exists and `getSupabase`, call `hydrateEffectiveCurrentUser(s.userId, s.email)`. If repaired or `effectiveRole !== s.role`, call `session.updateCurrentSessionUser({ role: hydrated.effectiveRole })` and refresh `currentUser`. Return `session.getCurrentSession()` so the renderer gets the updated role.

### Auth logs added

- `[auth] role from local DB before repair`
- `[auth] repairing local role from X to Y`
- `[auth] role from local DB after repair` / `[auth] role from local DB after sync`
- `[auth] loaded current user (session)`
- `[auth] planlux:session – effective role in renderer`
- Supabase fallback: “fallback to HANDLOWIEC (profile returned null)” / “profile fetch failed – fallback to HANDLOWIEC”

### Admin UI

- **MainLayout.tsx**: `isBossOrAdmin = canAccessAdmin` so admin visibility and “all offers” use one role source (`user.role` via `canAccessAdminPanel`).

### PDF

- **Payload**: Require `offer`, `pricing`, `offerNumber`; on failure return `missingFields` and log `[pdf] payload validation failed – missing fields`.
- **Template**: On missing template, log DIAGNOSTYKA with `appPath`, `resourcesPath`, `cwd`, `isPackaged`, `attemptedTemplatePaths` (from `getPdfTemplateDirCandidates()`); return `stage: 'TEMPLATE_MISSING'`.
- **After generation**: If template result is ok, check `fs.existsSync(outPath)`; if missing, log DIAGNOSTYKA and return error with `stage: 'WRITE_FAILED'`; else log `[pdf] generation success`.
- **Persistence**: PDF generation success path wrapped in try/catch; on catch return `ok: true`, `filePath`, `fileName`, `stage: 'PERSISTENCE_FAILED'`, `persistenceError`, so the file result is not hidden.
- **Types**: `PdfHandlerResult` success branch allows `stage?`, `persistenceError?`; error branch allows `missingFields?`, `stage?`, `details?`.
- **Logs**: `[pdf] start`, `[pdf] payload validation`, `[pdf] templateDir`, `[pdf] attempted template paths`, `[pdf] outputPath`, `[pdf] generation success`, `[pdf] DIAGNOSTYKA` (template missing / file missing), `[pdf] generation failed` (via existing error log).

---

## 4. New IPC Handlers

| Channel | Purpose |
|---------|--------|
| `planlux:auth:debugCurrentUser` | Returns current session user, role from session, from local SQLite, from Supabase profile (if available), final effective role, and whether there is a mismatch. No auth required for structure; no session → ok: false, nulls. |
| `planlux:auth:repairCurrentUserRole` | For current logged-in user: fetch Supabase profile role, compare with local, repair local if mismatch, refresh in-memory session role, return `{ ok: true, effectiveRole, repaired }`. Throws if no valid session. |

Both are registered in preload’s `ALLOWED_CHANNELS`. Invoke via `window.planlux.invoke("planlux:auth:debugCurrentUser")` and `window.planlux.invoke("planlux:auth:repairCurrentUserRole")`.

---

## 5. Manual Test Steps

1. **Admin repair on login**
   - In Supabase: set `public.profiles.role = 'ADMIN'` for the test user.
   - In local SQLite: set `users.role = 'HANDLOWIEC'` (or SZEF) for that email.
   - Log in online with that user.
   - Expect: logs show “role from local DB before repair”, “repairing local role from X to Y”, “role from local DB after repair”; session and UI show ADMIN; admin panel visible.

2. **Session refresh**
   - With a session already loaded (e.g. after login), call `planlux:session` again (e.g. reload app or trigger a session check). With Supabase available, expect session role to be refreshed from Supabase and, if repaired, logs and returned session show updated role.

3. **Debug / repair IPC**
   - While logged in: `planlux:auth:debugCurrentUser` → inspect session, local, Supabase roles and mismatch.
   - If local was wrong: `planlux:auth:repairCurrentUserRole` → expect `repaired: true` and session role updated; next `planlux:session` or UI uses new role.

4. **Admin UI**
   - As ADMIN: admin tab visible; as SZEF: same (if business rules allow); as HANDLOWIEC: admin tab not visible. Single source: `user.role` and `canAccessAdminPanel(user.role)`.

5. **PDF**
   - Missing payload: omit `offer` or `pricing` or `offerNumber` → explicit error and `missingFields` in response.
   - Missing template: remove or rename template dir, trigger generation → DIAGNOSTYKA log with attempted paths; error with `stage: 'TEMPLATE_MISSING'`.
   - Success: after generation, check log for “generation success” and returned `filePath`; verify file exists.
   - Persistence failure: simulate DB/insert failure after generation (e.g. disconnect DB or break insert) → response should still be success with `filePath`/`fileName` and `stage: 'PERSISTENCE_FAILED'`, `persistenceError`.

---

## 6. Manual Local SQLite Editing After This Fix

**Not required** for the common case “Supabase has ADMIN, local was stale”. The login flow and session refresh will repair local `users.role` and session role. Manual SQLite edit is only needed if:

- The user never logs in again (e.g. only restores session and Supabase is unreachable), or
- You need to fix a different user’s role without that user logging in.

For the current user, `planlux:auth:repairCurrentUserRole` can fix role drift without re-login as long as Supabase is available.
