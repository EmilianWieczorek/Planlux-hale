# Pricing: Relational Tables as Source of Truth

Pricing is loaded from **Supabase relational tables** (primary) and cached locally for offline use. The legacy `base_pricing.payload` JSON is no longer used for pricing.

## Tables (Supabase)

- **`pricing_surface`** – One row per variant + area tier: `variant`, `name`, `area_min_m2`, `area_max_m2`, `price`, `unit`
- **`addons_surcharges`** – One row per variant + addon: `variant`, `nazwa`, `stawka`, `jednostka`, optional `warunek*`
- **`standard_included`** – One row per variant + element: `variant`, `element`, `ilosc`, `wartosc_ref`

Migration: `supabase/migrations/20260306000000_relational_pricing_tables.sql`

## In-memory model

- **`HallVariant`**: `variant`, `name`, `tiers: PricingTier[]`
- **`PricingTier`**: `min`, `max`, `price`, `unit?`

Surface rows are grouped by `variant + name` into `HallVariant[]`; each variant has multiple tiers. The engine and cache use a flattened **cennik** (one row per tier, same `wariant_hali`/`Nazwa` for the variant).

## Data flow

1. **Sync (online)**  
   `configSync` calls `api.getRelationalPricing()` → `fetchRelationalPricing(supabase)` loads the three tables, builds `HallVariant[]`, flattens to `cennik` → `saveBase(db, base)` writes to `pricing_cache` and `pricing_surface` / `addons_surcharges` / `standard_included` (local SQLite as JSON blobs for offline).

2. **Offline / fallback**  
   If relational fetch fails or returns empty: load from local SQLite tables (`loadBaseFromLocalTables`) or run `seedBaseIfEmpty`, then save to cache.

3. **Runtime**  
   `getCachedBase(db)` and `planlux:getPricingCache` return `cennik`/`dodatki`/`standard` from `pricing_cache`. The variant dropdown uses distinct `wariant_hali` + `Nazwa` from `cennik`. `calculatePrice` matches by `variantHali` and `areaM2` (tier: `area_min_m2 <= area <= area_max_m2`).

## Variant dropdown

Shows **distinct** hall variants (grouped by `variant + name`), not one option per area tier. Implemented by building the list from `cennik` with a `Map` keyed by `wariant_hali` and label `Nazwa ?? wariant_hali`.

## Price selection

- `area = width * length` (m²).
- Tier: row where `area_min_m2 <= area <= area_max_m2` for the selected variant.
- Base price: `tier.price` (per m²) × area.  
Fallbacks (area outside ranges) and debug logs are in `packages/shared/src/pricing/pricingEngine.ts` (when `LOG_LEVEL=debug`).

## Debug logs (`LOG_LEVEL=debug`)

- **Relational loader**: raw surface row count, grouped variant count, variant labels, cennik/dodatki/standard counts.
- **Pricing engine**: input variant/area, matched tier (min/max/price), fallback reason when used, source row keys.

## Files

- **Types**: `packages/shared/src/pricing/types.ts` (`PricingTier`, `HallVariant`)
- **Loader**: `packages/desktop/src/services/relationalPricingLoader.ts` (`fetchRelationalPricing`, `buildHallVariants`, `hallVariantsToCennik`)
- **Adapter**: `packages/desktop/electron/supabase/apiAdapter.ts` (`getRelationalPricing`)
- **Sync**: `packages/desktop/src/services/configSync.ts` (uses `getRelationalPricing` first; fallback local/seed)
- **Engine**: `packages/shared/src/pricing/pricingEngine.ts` (unchanged; still uses `cennik` + area tier matching)
