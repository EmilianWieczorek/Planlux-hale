# Audyt usunięcia Google Apps Script

## Lista plików i miejsc użycia GAS (do usunięcia/zmiany)

### Kod (zmiana lub usunięcie)
| Plik | Opis |
|------|------|
| `packages/desktop/electron/authBackend.ts` | Cały moduł: login, listUsers, upsertUser przez POST do GAS. Zastąpiony przez Supabase Auth + profiles + Edge Function (createUser). |
| `packages/desktop/electron/ipc.ts` | Komentarze "Apps Script", "Sheets"; wywołania listUsersFromBackend, loginViaBackend, upsertUserViaBackend – przekierować na Supabase. |
| `packages/desktop/electron/supabase/apiAdapter.ts` | Komentarz "Replaces Google Apps Script" – zostawić (opis). |
| `packages/desktop/renderer/.../OfferDetailsView.tsx` | Tekst błędu "Apps Script zwrócił...", "Zapis do Google Sheets" – zmienić na "Backend/Supabase". |
| `packages/desktop/renderer/.../AdminPanel.tsx` | "Użytkownicy z arkusza USERS (Google Sheets)" – zmienić na "Supabase (profiles)". |
| `packages/desktop/renderer/.../AdminUpdatesTab.tsx` | Komentarz "historia z Apps Script" – zmienić. |
| `packages/desktop/renderer/.../MainLayout.tsx` | Komentarz "version from Apps Script" – zmienić. |

### Konfiguracja / shared
| Plik | Opis |
|------|------|
| `packages/desktop/electron/config.ts` | Już bez GAS (komentarz "No Google Apps Script"). |
| `packages/desktop/src/config.ts` | Już "Supabase only". |
| `packages/shared/src/api/client.ts` | Już "No Google Apps Script". |

### Dokumentacja (aktualizacja)
| Plik | Opis |
|------|------|
| `docs/API_CONTRACT.md` | Base URL GAS – zastąpić opisem API Supabase (Postgres, Edge Functions). |
| `docs/TEST-AUTH-OFFLINE-FIRST.md` | Backend Apps Script, URL script.google.com – przepisać na Supabase. |
| `docs/TEST-UPDATES-VERSION.md` | Apps Script – przepisać (updates z innego źródła lub Supabase). |
| `docs/ARCHITECTURE.md` | "Apps Script", "Sheets" – zamienić na Supabase. |
| `docs/CRM-IMPLEMENTATION-ROADMAP.md` | "Apps Script" – zamienić. |
| `docs/TROUBLESHOOTING.md` | "Google Apps Script" – zamienić. |
| `docs/ADMIN_PANEL.md` | "Google Sheets" – zamienić. |
| `docs/EMAIL-HISTORY-VERIFICATION.md` | "Google Sheets" – zamienić. |
| `README.md` | "Apps Script / API" – "Supabase". |
| `README-ARCH.md` | "Google Apps Script" – "Supabase". |

### Nie zmieniać (false positive)
| Plik | Powód |
|------|--------|
| `packages/desktop/electron/errors/AppError.ts` | "Sesja wygasła" – nie GAS. |
| `package-lock.json` | "integrity" – nie GAS. |

---

## Wykonane w FAZA 0
- [x] Lista plików (ten dokument)
- [x] authSupabase (Supabase Auth + profiles); authBackend pozostawiony tylko gdy getSupabase brak (np. testy)
- [x] IPC: syncUsers i login używają Supabase gdy getSupabase; createUser wywołuje Edge Function create-user
- [x] Komentarze i teksty UI zaktualizowane (OfferDetailsView, AdminPanel, AdminUpdatesTab, MainLayout)
- [x] Dokumentacja (API_CONTRACT, README, SUPABASE-SETUP) zaktualizowana
