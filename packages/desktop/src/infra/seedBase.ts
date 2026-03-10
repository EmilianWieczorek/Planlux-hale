/**
 * Seed local SQLite tables (pricing_surface, addons_surcharges, standard_included)
 * when all are empty so the app has a minimal pricing base for the calculator.
 */

type Db = ReturnType<typeof import("better-sqlite3")>;

function tableEmpty(db: Db, table: string): boolean {
  try {
    const row = db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    return row == null;
  } catch {
    return true;
  }
}

/** Default cennik rows (pricing_surface) – Polish keys for app compatibility. */
const DEFAULT_CENNIK: Array<Record<string, unknown>> = [
  { wariant_hali: "T18_T35_DACH", Nazwa: "Hala T18 + T35 dach", cena: 350, area_min_m2: 1, area_max_m2: 5000, stawka_jedn: "m2" },
  { wariant_hali: "T18_T35_POL", Nazwa: "Hala T18 + T35 pełna", cena: 380, area_min_m2: 1, area_max_m2: 5000, stawka_jedn: "m2" },
  { wariant_hali: "T22_T35_DACH", Nazwa: "Hala T22 + T35 dach", cena: 370, area_min_m2: 1, area_max_m2: 5000, stawka_jedn: "m2" },
  { wariant_hali: "T22_T35_POL", Nazwa: "Hala T22 + T35 pełna", cena: 400, area_min_m2: 1, area_max_m2: 5000, stawka_jedn: "m2" },
  { wariant_hali: "T18_T35_DACH", Nazwa: "Hala T18 + T35 dach (mała)", cena: 360, area_min_m2: 1, area_max_m2: 500, stawka_jedn: "m2" },
  { wariant_hali: "T22_T35_DACH", Nazwa: "Hala T22 + T35 dach (mała)", cena: 380, area_min_m2: 1, area_max_m2: 500, stawka_jedn: "m2" },
  { wariant_hali: "T18_T35_POL", Nazwa: "Hala T18 + T35 pełna (mała)", cena: 390, area_min_m2: 1, area_max_m2: 500, stawka_jedn: "m2" },
  { wariant_hali: "T22_T35_POL", Nazwa: "Hala T22 + T35 pełna (mała)", cena: 410, area_min_m2: 1, area_max_m2: 500, stawka_jedn: "m2" },
  { wariant_hali: "T18_T35_DACH", Nazwa: "Hala T18 + T35 dach (średnia)", cena: 355, area_min_m2: 501, area_max_m2: 1500, stawka_jedn: "m2" },
  { wariant_hali: "T22_T35_DACH", Nazwa: "Hala T22 + T35 dach (średnia)", cena: 375, area_min_m2: 501, area_max_m2: 1500, stawka_jedn: "m2" },
];

/** Default addons (addons_surcharges). */
const DEFAULT_ADDONS: Array<Record<string, unknown>> = [
  { wariant_hali: "T18_T35_DACH", nazwa: "Dopłata za wysokość", stawka: 40, jednostka: "m2" },
  { wariant_hali: "T18_T35_DACH", nazwa: "Dopłata za bramę", stawka: 1200, jednostka: "szt" },
  { wariant_hali: "T18_T35_DACH", nazwa: "Dopłata za świetliki", stawka: 25, jednostka: "m2" },
  { wariant_hali: "T22_T35_DACH", nazwa: "Dopłata za wysokość", stawka: 45, jednostka: "m2" },
  { wariant_hali: "T22_T35_DACH", nazwa: "Dopłata za bramę", stawka: 1300, jednostka: "szt" },
  { wariant_hali: "T22_T35_DACH", nazwa: "Dopłata za świetliki", stawka: 28, jednostka: "m2" },
  { wariant_hali: "T18_T35_POL", nazwa: "Dopłata za wysokość", stawka: 42, jednostka: "m2" },
  { wariant_hali: "T18_T35_POL", nazwa: "Dopłata za bramę", stawka: 1250, jednostka: "szt" },
  { wariant_hali: "T22_T35_POL", nazwa: "Dopłata za wysokość", stawka: 47, jednostka: "m2" },
  { wariant_hali: "T22_T35_POL", nazwa: "Dopłata za bramę", stawka: 1350, jednostka: "szt" },
];

/** Default standard included (standard_included). */
const DEFAULT_STANDARD: Array<Record<string, unknown>> = [
  { wariant_hali: "T18_T35_DACH", element: "Konstrukcja stalowa", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T18_T35_DACH", element: "Pokrycie dachowe", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T18_T35_DACH", element: "Ściany boczne", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T22_T35_DACH", element: "Konstrukcja stalowa", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T22_T35_DACH", element: "Pokrycie dachowe", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T18_T35_POL", element: "Konstrukcja stalowa", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T18_T35_POL", element: "Pokrycie pełne", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T22_T35_POL", element: "Konstrukcja stalowa", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T22_T35_POL", element: "Pokrycie pełne", ilosc: 1, wartosc_ref: 1, uwagi: "" },
  { wariant_hali: "T18_T35_DACH", element: "Fundament", ilosc: 1, wartosc_ref: 1, uwagi: "w cenie" },
];

/**
 * If pricing_surface, addons_surcharges and standard_included are all empty,
 * insert default seed data (10 rows each). Idempotent: only runs when all three are empty.
 * Returns true if seed was performed, false if data already exists.
 */
export function seedBaseIfEmpty(db: Db): boolean {
  try {
    const hasSurface = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_surface'").get() as { name?: string } | undefined;
    const hasAddons = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='addons_surcharges'").get() as { name?: string } | undefined;
    const hasStandard = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='standard_included'").get() as { name?: string } | undefined;
    if (!hasSurface?.name || !hasAddons?.name || !hasStandard?.name) return false;

    const surfaceEmpty = tableEmpty(db, "pricing_surface");
    const addonsEmpty = tableEmpty(db, "addons_surcharges");
    const standardEmpty = tableEmpty(db, "standard_included");
    if (!surfaceEmpty || !addonsEmpty || !standardEmpty) return false;

    const insSurface = db.prepare("INSERT INTO pricing_surface (data_json) VALUES (?)");
    for (const row of DEFAULT_CENNIK) {
      insSurface.run(JSON.stringify(row));
    }

    const insAddons = db.prepare("INSERT INTO addons_surcharges (data_json) VALUES (?)");
    for (const row of DEFAULT_ADDONS) {
      insAddons.run(JSON.stringify(row));
    }

    const insStandard = db.prepare("INSERT INTO standard_included (data_json) VALUES (?)");
    for (const row of DEFAULT_STANDARD) {
      insStandard.run(JSON.stringify(row));
    }

    try {
      db.prepare("UPDATE config_sync_meta SET version = 1, last_synced_at = ? WHERE id = 1").run(new Date().toISOString());
    } catch {
      // ignore
    }
    return true;
  } catch (e) {
    if (process.env.NODE_ENV !== "production" || process.env.LOG_LEVEL === "debug") {
      console.warn("[seedBase] seedBaseIfEmpty failed", e instanceof Error ? e.message : String(e));
    }
    return false;
  }
}
