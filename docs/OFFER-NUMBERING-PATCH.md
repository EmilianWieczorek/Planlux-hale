# Offer Numbering Fix – Patch Summary

## Commit Message

```
fix: offer numbering – online PLX, offline TEMP, no draft override

- createOffer: robust online check (ping backend) before reserveOfferNumber
- saveOfferDraft: never generate TEMP; never override offer_number on UPDATE
- sync moved to renderer: after save when online+TEMP, badge "Rezerwuję numer…"
- Snackbar on sync failure; syncTempOfferNumbers returns updated list
```

---

## Modified Files

### 1. `packages/desktop/electron/ipc.ts`

**Changes:**
- Added `checkOnline()` – pings backend (`action: "health"`) before reserveOfferNumber
- `createOffer`: calls `checkOnline()` first; only reserves PLX when online
- `getNextOfferNumber`: uses `checkOnline()` instead of try/catch on reserveOfferNumber
- `saveOfferDraft`:
  - **Removed** sync block (no longer calls `doSyncTempOfferNumbers`)
  - **Removed** `syncedOfferNumber` from return
  - **Split** INSERT vs UPDATE: for existing rows, only UPDATE other fields (never `offer_number`)
  - Returns `{ ok: true }` only (no syncedOfferNumber)

### 2. `packages/desktop/renderer/src/state/offerDraftStore.ts`

**Changes:**
- `syncingOfferNumber` state + `getSyncingOfferNumber()`
- `setSyncErrorHandler(fn)` – for Snackbar on sync failure
- `requestSyncTempNumbers()` – runs sync, sets badge, updates offerNumber, calls error handler
- `saveToBackend()`: after save, if TEMP and online → calls sync; updates offerNumber from `updated`; on fail → `syncErrorHandler`

### 3. `packages/desktop/renderer/src/state/useOfferDraft.ts`

**Changes:**
- `getState()` includes `syncingOfferNumber: offerDraftStore.getSyncingOfferNumber()`

### 4. `packages/desktop/renderer/src/app/App.tsx`

**Changes:**
- `setSyncErrorHandler` on mount
- `syncError` state + Snackbar for sync errors

### 5. `packages/desktop/renderer/src/features/kalkulator/Kalkulator.tsx`

**Changes:**
- Badge "Rezerwuję numer…" when `syncingOfferNumber` (not `TEMP && online`)
- `runSyncOfferNumber` uses `requestSyncTempNumbers()`, shows toast on success

### 6. `packages/desktop/renderer/src/features/oferty/OfertyView.tsx`

**Changes:**
- `syncingNumbers` state during load sync
- Badge "Rezerwuję numer…" for TEMP offers when `syncingNumbers`
- `syncError` state + Snackbar when sync fails on load

---

## Test Scenarios

| Scenario | Expected |
|----------|----------|
| **Online create** | `createOffer` → ping OK → `reserveOfferNumber` → PLX-&lt;INICJAŁ&gt;&lt;0001&gt;/&lt;YEAR&gt; |
| **Offline create** | `createOffer` → ping fail → TEMP-&lt;deviceId&gt;-&lt;timestamp&gt; |
| **Multiple autosaves** | `saveOfferDraft` never changes `offer_number`; UPDATE doesn’t touch it |
| **Sync after save** | Store calls `syncTempOfferNumbers` when TEMP+online; UI updates from `updated` |
| **Sync failure** | Snackbar shows error |
| **Badge** | "Rezerwuję numer…" during sync |

---

## Build

```bash
npm install
npm run build
```

If you see `spawn EPERM`, run in a normal terminal (outside sandbox).
