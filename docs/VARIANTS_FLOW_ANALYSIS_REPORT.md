# Raport analizy przepływu wariantów – Planlux Hale

**Data analizy:** na podstawie aktualnego kodu w repozytorium.  
**Zakres:** end-to-end od SQLite do UI (dropdown, selectedVariant, kalkulacja, draft restore).  
**Cel:** precyzyjna lokalizacja przyczyny problemu z wariantami, bez wdrażania finalnych poprawek.

---

## 1. MAPA PRZEPŁYWU DANYCH WARIANTÓW

### 1.1 Źródło prawdy (source of truth)

- **Runtime:** tabela `pricing_cache` (kolumna `cennik_json`). Jedna wiersz – najwyższa `pricing_version`. Odczyt przez `getCachedBase(db)`.
- **Backup:** tabele `pricing_surface`, `addons_surcharges`, `standard_included` (dane w `data_json`). Używane gdy `pricing_cache` pusta – `loadBaseFromLocalTables(db)`.
- **Zapis do cache:** `saveBase(db, base)` – wstawia/aktualizuje wiersz w `pricing_cache` i wywołuje `writeBaseToLocalTables(db, base)`.

### 1.2 Kolejność od bazy do UI

```
SQLite: pricing_cache (cennik_json) / pricing_surface (data_json)
    ↓
getCachedBase(db) → CachedBase | null  { version, lastUpdated, cennik[], dodatki[], standard[] }
    ↓ (gdy null lub cennik pusty)
loadBaseFromLocalTables(db) → CachedBase | null
    ↓ (gdy nadal pusto)
seedBaseIfEmpty(db) → bool, potem ponownie loadBaseFromLocalTables
    ↓ (opcjonalnie default-pricing.json w main bootstrap)
saveBase(db, base) → zapis do pricing_cache + writeBaseToLocalTables
    ↓
IPC: planlux:getPricingCache / base:sync
    ↓ zwracają: { ok, data: base | EMPTY_PRICING }
    ↓
Renderer: loadPricing() / autoSync() → setPricingData(data)
    ↓
pricingData (useState) → obiekt z cennik[], dodatki[], standard[]
    ↓
normalizeVariantsFromPricing(pricingData) → { variants: { id, name }[], source }
    ↓
variants (useMemo) = normalizedVariants
    ↓
draft.variantHali (z offerDraftStore) → selectedVariant w UI
    ↓
<select value={variantHaliValid ? variantHali : variants[0]?.id}> + options z variants
    ↓
standardOptions / rawAddonsForVariant filtrowane po variantHali
    ↓
planlux:calculatePrice({ variantHali, ... }) → odczyt cennik_json z pricing_cache w main
```

### 1.3 Kto wypełnia pricing_cache

| Miejsce | Kiedy |
|--------|--------|
| **main.ts (bootstrap)** | Po migracjach: seedBaseIfEmpty → przy pustym COUNT reseed + loadBaseFromLocalTables + saveBase; syncConfig(); potem jeśli cache nadal pusta: loadBaseFromLocalTables / seed / default-pricing.json → saveBase. |
| **configSync (syncConfig)** | Pobiera z Supabase (getRelationalPricing) lub getBase; przy braku danych: loadBaseFromLocalTables + ewentualnie seedBaseIfEmpty → saveBase. |
| **IPC getPricingCache** | getCachedBase → przy braku: loadBaseFromLocalTables, seedBaseIfEmpty, saveBase → zwraca base lub EMPTY_PRICING. |
| **IPC base:sync** | syncConfig() → getCachedBase() → zwraca base lub EMPTY_PRICING (nie null). |

### 1.4 Kiedy draft.variantHali jest ustawiany

| Źródło | Wartość |
|--------|--------|
| **createEmptyDraft()** | `"T18_T35_DACH"` (domyślna). |
| **hydrate(loaded)** | `loaded.variantHali` (z zapisanego draftu z main/backend). **Bez walidacji** – może być dowolny string (np. stary identyfikator). |
| **restoreVersion(v)** | `v.payload?.offer?.variantHali ?? s.variantHali`. |
| **Kalkulator useEffect** | Gdy `!variantHaliValid` i `normalizedVariants.length > 0` → `actions.setVariantHali(normalizedVariants[0].id)`. |

Hydracja draftu: `App.tsx` i `MainLayout.tsx` wywołują `planlux:loadOfferDraft` i `offerDraftStore.hydrate(draft)` po zalogowaniu. Draft (w tym `variantHali`) może przyjść **równolegle** z pierwszym `loadPricing` / `autoSync` – kolejność nie jest z góry ustalona.

---

## 2. WYNIK ANALIZY

### 2.1 Co działa poprawnie (w obecnym kodzie)

- **Baza i seed:** `seedBaseIfEmpty` wypełnia `pricing_surface` rekordami z `wariant_hali` i `Nazwa` (DEFAULT_CENNIK). Shape jest spójny z oczekiwaniami UI.
- **getCachedBase / loadBaseFromLocalTables:** Zwracają obiekt z `cennik: unknown[]`; parsowanie `data_json` i składanie do `cennik[]` jest poprawne. Dla wierszy bez `wariant_hali` w seedzie nie ma – wszystkie wiersze mają `wariant_hali`.
- **IPC (po ostatnich poprawkach):** Gdy cache pusta, zwracany jest `data: { ...EMPTY_PRICING }` zamiast `null`, więc renderer zawsze dostaje obiekt z `cennik` (nawet pustą tablicą).
- **Renderer:** Przy `r.ok` ustawiane jest zawsze obiekt: `data = r.data && Array.isArray(r.data.cennik) ? r.data : EMPTY_PRICING_DATA`, więc `pricingData` nie zostaje „na null” po odpowiedzi IPC.
- **normalizeVariantsFromPricing:** Przy pustym lub brakującym `cennik` zwraca `defaultVariants` (4 warianty). Przy niepustym cenniku buduje listę z `wariant_hali` / `variant` i `Nazwa` / `name`, odrzuca puste id, deduplikuje. Jedno wejście → jedna lista wariantów.
- **Korekta invalid selectedVariant:** useEffect w Kalkulatorze ustawia `variantHali` na `normalizedVariants[0].id`, gdy aktualny `draft.variantHali` nie występuje w liście.
- **Select:** `value={variantHaliValid ? variantHali : (variants[0]?.id ?? "")}` – wartość selecta jest zawsze z listy opcji (brak „wiszącej” wartości).

### 2.2 Co może nadal powodować problemy

1. **Kolejność bootstrap vs. okno vs. pierwszy IPC**
   - Bootstrap w main (migracje, seed, syncConfig, uzupełnienie cache) wykonuje się w `app.whenReady()`, **przed** `registerIpcHandlers`. Okno jest tworzone wcześniej (createWindow na początku whenReady). Renderer ładuje się i może wywołać `planlux:getPricingCache` lub `base:sync` zanim bootstrap w pełni zakończy zapis do `pricing_cache`.
   - **Nie da się tego potwierdzić wyłącznie z kodu** – zależy od czasu sieci (syncConfig), czasu ładowania okna i momentu mountu Kalkulatora. Logi `[variants][main] bootstrap_done` vs. pierwsze wywołanie getPricingCache pokażą kolejność.

2. **Draft restore vs. pierwsza lista wariantów**
   - Jeśli `hydrate(draft)` ustawi `variantHali` na wartość spoza aktualnej listy (np. stary identyfikator z backendu), to:
     - Przy pustym cenniku lista to `defaultVariants` (T18_T35_DACH, T18_T35_POL, T22_T35_DACH, T22_T35_POL). Każdy inny id (np. "TERM_60_PNEU") → `variantHaliValid === false` → useEffect koryguje na pierwszy wariant.
     - Korekta zależy od tego, że `normalizedVariants` jest już obliczone. Jeśli w momencie hydracji `pricingData` jest nadal `null`, to `normalizedVariants = defaultVariants`; po hydracji draft ma stary id → efekt korekty powinien zadziałać.
   - **Ryzyko:** gdyby `hydrate` był wywoływany **po** korekcie (np. drugi raz z tym samym draftem), z zapisanym starym `variantHali`, nadpisałby poprawny wariant z powrotem na niepoprawny. W kodzie nie widać drugiego wywołania hydrate z tym samym draftem bez ponownego ładowania; gdyby tak było, efekt i tak by się ponownie uruchomił (zależność od `draft.variantHali`).

3. **Shape danych z Supabase**
   - `getRelationalPricing` (relationalPricingLoader) buduje cennik z tabel Supabase. Kolumny mogą mieć inne nazwy (np. `variant` zamiast `wariant_hali`, `name` zamiast `Nazwa`). W `normalizeVariantsFromPricing` i w configSync/getVariantCount używane są `wariant_hali ?? variant` i `Nazwa ?? name`. **Jeśli Supabase zwraca tylko np. `hall_variant` i nie ma mapowania**, warianty z chmury mogłyby mieć puste id w UI. Wymaga to sprawdzenia w `relationalPricingLoader` i w rzeczywistych odpowiedziach API.

4. **Wyjątki przy odczycie cache**
   - `getCachedBase`: `JSON.parse(row.cennik_json)` – przy uszkodzonym JSONu rzuca. Handler IPC łapie błąd i zwraca `{ ok: false, error }`. Wtedy renderer **nie** wywołuje `setPricingData` (sprawdza tylko `r.ok`), więc `pricingData` pozostaje w poprzednim stanie (np. null przy pierwszym wywołaniu). W takim przypadku lista wariantów pochodziłaby wyłącznie z `defaultVariants` (bo `pricingData` null → normalize zwraca defaultVariants), ale użytkownik nie dostałby danych z cache.

---

## 3. PRAWDZIWA PRZYCZYNA BŁĘDU (wnioski z kodu)

### 3.1 Główna przyczyna historyczna (już załataną w kodzie)

- **Plik:** `packages/desktop/electron/ipc.ts` (handlery `planlux:getPricingCache` i `base:sync`).
- **Mechanizm:** Zwracanie `data: null` przy pustej cache. W rendererze `if (r.ok && r.data) setPricingData(r.data)` – przy `data === null` `pricingData` nigdy nie było ustawiane, więc pozostawało `null`, a lista wariantów w useMemo opierała się na `pricingData?.cennik` i przy null dawała `defaultVariants`, przy jednoczesnym braku jawnie ustawionego obiektu pricing (komunikaty, przyciski oparte na `!pricingData`).
- **Status:** Obecnie IPC zwraca przy pustej cache `data: { ...EMPTY_PRICING }`, a renderer przy `r.ok` zawsze ustawia obiekt (pełny lub EMPTY_PRICING_DATA). Czyli **główna przyczyna jest usunięta w aktualnym kodzie**.

### 3.2 Możliwe pozostałe przyczyny (wymagają weryfikacji w runtime)

| # | Miejsce | Plik / funkcja | Co może być nie tak |
|---|--------|-----------------|----------------------|
| A | Kolejność startu | main.ts (whenReady) | Renderer wywołuje getPricingCache zanim bootstrap zapisze do pricing_cache. GetPricingCache wtedy robi loadBaseFromLocalTables + seed + saveBase i zwraca dane – **teoretycznie** powinno być ok, o ile tabele już istnieją. Na świeżej instalacji tabele tworzy pierwsze getDb() w bootstrapie, więc przy pierwszym getPricingCache tabele są. Jedyny scenariusz: getDb() jeszcze nie wywołane w momencie pierwszego IPC – **niemożliwe**, bo IPC rejestrowane jest po zakończeniu bootstrapu. |
| B | Wyjątek w getCachedBase | db.ts getCachedBase | Uszkodzony `cennik_json` (np. niepoprawny JSON) → throw → IPC zwraca ok: false → renderer nie ustawia pricingData. **Potwierdzenie:** logi błędów IPC + sprawdzenie zawartości `pricing_cache.cennik_json` w SQLite. |
| C | Nazwy pól z Supabase | relationalPricingLoader / Supabase | Cennik z chmury ma inne nazwy pól (np. brak `wariant_hali`/`variant`). W UI warianty by się nie pojawiły albo były puste. **Potwierdzenie:** log [variants][main] base:sync result (sample_variants); jeśli length 0 przy niepustym cennik – problem nazw. |
| D | Hydracja draftu po korekcie | App / MainLayout + offerDraftStore.hydrate | Draft z backendu z starym `variantHali` nadpisuje stan po korekcie. **Potwierdzenie:** log [variants][renderer] restored variant invalid – czy pojawia się wielokrotnie po hydracji. |

### 3.3 Gdzie dokładnie szukać, jeśli problem nadal występuje

- **Main:** Po starcie aplikacji w logach (userData/logs): `[variants][main] bootstrap_done` – czy `cennik_entries` i `unique_variants` > 0. Jeśli 0 – problem jest w bootstrapie/cache/seedzie.
- **Main:** Przy `LOG_LEVEL=debug` lub `PLANLUX_VARIANTS_DEBUG=1`: `[variants][main] getPricingCache` / `base:sync result` – czy zwracane są niepuste `cennik_entries` i `sample_variants`.
- **Renderer:** W konsoli (F12): `[variants][renderer] state` – czy `pricingDataReceived`, `cennikCount`, `variantsCount`, `selectedVariantInList`. Jeśli `selectedVariantInList: false` mimo korekty – możliwy konflikt z hydracją lub kolejnością.
- **Baza:** Ręcznie: `SELECT length(cennik_json), substr(cennik_json,1,200) FROM pricing_cache ORDER BY pricing_version DESC LIMIT 1` – czy jest wiersz i czy JSON wygląda poprawnie (tablica obiektów z `wariant_hali` lub `variant`).

---

## 4. OBJAWY VS PRZYCZYNA

| Objaw | Przyczyna (jeśli nadal występuje) |
|-------|-----------------------------------|
| Pusta lista wariantów w dropdownie | Albo `pricingData` nadal null (np. wyjątek w IPC/getCachedBase, brak setPricingData), albo `pricingData.cennik` pusta i defaultVariants nie używane (obecnie używane są), albo błąd w normalizeVariantsFromPricing (obecnie przy pustym cennik zwraca defaultVariants). |
| "Brak ceny – brak wariantu w cenniku" | calculatePrice dostaje `variantHali`, którego nie ma w wierszu z pricing_cache (np. stary id z draftu przed korektą, albo cennik z innego źródła z innymi id). |
| Dropdown pokazuje wartość, ale kalkulacja nie działa | Rozjazd między `draft.variantHali` a listą wariantów (np. korekta się nie wykonała lub została nadpisana przez hydrate). |
| Działa u dewelopera, nie na PC handlowca | Różnica środowiska: pusta baza / brak sieci przy pierwszym uruchomieniu (sync nie pobiera, seed musi wypełnić); inna ścieżka do pliku bazy; błąd w getCachedBase/parse; RLS Supabase zwraca puste. |

---

## 5. RYZYKA (produkcja)

- **Błąd w JSON w pricing_cache:** Jeden uszkodzony wiersz (np. ręczna edycja DB) → getCachedBase rzuca → IPC error → brak setPricingData. Trzeba łapać błąd parsowania i zwracać np. EMPTY_PRICING z logiem.
- **Supabase zwraca inny shape:** Relational tables z innymi nazwami kolumn bez mapowania na `wariant_hali`/`Nazwa` → po sync cennik ma 0 użytecznych wariantów w UI. Należy zweryfikować relationalPricingLoader i odpowiedzi API.
- **Draft z innego środowiska:** Zapisywany draft z `variantHali`, którego nie ma w aktualnym cenniku (np. inna wersja produktu) → po hydracji `variantHaliValid === false` → korekta w useEffect. Ryzyko: wielokrotne hydracje lub opóźnione ładowanie draftu mogą na chwilę pokazać niepoprawny wariant.
- **Race loadPricing vs autoSync:** Oba ustawiają pricingData. Który skończy ostatni, wygrywa. Jeśli najpierw loadPricing ustawi pełne dane, potem autoSync zwróci błąd i ustawi EMPTY_PRICING_DATA – stan się pogorszy. W kodzie przy `r.ok` ustawiane są zawsze poprawne dane; przy błędzie autoSync nie wywołuje setPricingData, więc nie nadpisuje. Ryzyko jest niskie.

---

## 6. REKOMENDACJA NAPRAWY (plan, bez wdrażania kodu)

1. **Weryfikacja w runtime (priorytet)**  
   - Uruchomić aplikację z `LOG_LEVEL=debug` lub `PLANLUX_VARIANTS_DEBUG=1`.  
   - Sprawdzić logi: `[variants][main] bootstrap_done`, `getPricingCache`, `base:sync result`.  
   - W rendererze (F12): `[variants][renderer] state`, `loadPricing`, `restored variant invalid`.  
   - Na maszynie, gdzie problem występuje: sprawdzić, czy bootstrap_done ma `cennik_entries`/`unique_variants` > 0 i czy renderer dostaje `pricingDataReceived: true` oraz `selectedVariantInList: true`.

2. **Zabezpieczenie przed wyjątkiem w getCachedBase**  
   - W `getCachedBase` (lub w handlerze IPC): try/catch wokół `JSON.parse(row.cennik_json)`; przy błędzie zwrócić null lub pustą strukturę i zalogować błąd, żeby IPC nie zwracało wyjątku i renderer mógł ustawić EMPTY_PRICING_DATA.

3. **Walidacja variantHali przy hydracji**  
   - W `offerDraftStore.hydrate`: nie nadpisywać `variantHali` wartością z `loaded`, jeśli nie ma dostępu do listy ważnych wariantów; albo: dodać opcjonalny drugi argument `validVariantIds: string[]` i ustawiać `variantHali` tylko gdy `loaded.variantHali` jest w tej liście – w przeciwnym razie zostawić domyślny (np. z createEmptyDraft). Wymaga przekazania listy z miejsca, gdzie jest znana (np. po pierwszym załadowaniu pricing).

4. **Spójność nazw pól z Supabase**  
   - W `relationalPricingLoader` (i ewentualnie w Supabase view/funkcji) upewnić się, że wynikowe rekordy cennika mają pole `wariant_hali` lub `variant` oraz `Nazwa` lub `name`. Dodać log pierwszego rekordu po fetchu (np. w configSync przy debug).

5. **Jednokrotne ustawienie pricingData przy błędzie IPC**  
   - Gdy `planlux:getPricingCache` zwraca `ok: false`, w rendererze i tak ustawić `setPricingData(EMPTY_PRICING_DATA)`, żeby UI zawsze miało obiekt i pokazywało defaultVariants + komunikat o błędzie, zamiast pozostawiać null.

---

## 7. LISTA PLIKÓW DO ZMIAN (po analizie)

| Plik | Cel zmiany |
|------|------------|
| `packages/desktop/src/infra/db.ts` | Zabezpieczenie getCachedBase przed throw przy JSON.parse (try/catch, przy błędzie zwrócić null lub pusty CachedBase). |
| `packages/desktop/electron/ipc.ts` | Przy ok: false z getPricingCache – opcjonalnie zwracać też pustą strukturę (reason: "error"), żeby renderer mógł ustawić EMPTY i pokazać defaultVariants. |
| `packages/desktop/renderer/src/features/kalkulator/Kalkulator.tsx` | Przy r.ok === false w loadPricing: setPricingData(EMPTY_PRICING_DATA), żeby nie zostawiać pricingData jako null. |
| `packages/desktop/renderer/src/state/offerDraftStore.ts` | Opcjonalna walidacja variantHali w hydrate (np. przyjmować listę ważnych id i nie nadpisywać variantHali niepoprawną wartością). |
| `packages/desktop/src/services/relationalPricingLoader.ts` | Upewnić się, że z Supabase zwracane są pola wariant_hali/variant i Nazwa/name; ewentualne mapowanie; log przy debug. |

---

## 8. DODANA DIAGNOSTYKA (tylko logi)

- **Main:** Po zakończeniu bootstrapu (przed registerIpcHandlers) wywołanie `[variants][main] bootstrap_done` z: `pricing_cache_rows`, `pricing_surface_rows`, `cennik_entries`, `unique_variants`, `sample_variants`.
- **Renderer:** useEffect zależny od `pricingData`, `variants.length`, `draft.variantHali`, `variantsSource` – log `[variants][renderer] state` z: `pricingDataReceived`, `cennikCount`, `variantsCount`, `selectedVariant`, `selectedVariantInList`, `source`.

Żadne inne zachowanie nie zostało zmienione. Logi pozwalają zlokalizować, na którym etapie warianty są puste lub `selectedVariant` jest poza listą.
