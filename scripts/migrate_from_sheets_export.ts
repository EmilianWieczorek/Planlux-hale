/**
 * Jednorazowy import z eksportu Google Sheets do Supabase.
 * Używa SUPABASE_SERVICE_ROLE_KEY tylko tutaj (lokalnie, NIE w aplikacji).
 *
 * Użycie:
 * 1. Eksportuj Sheets do CSV (Plik -> Pobierz -> CSV).
 * 2. Umieść w ./imports/ (clients.csv, offers.csv, base_pricing.csv).
 * 3. SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx ts-node scripts/migrate_from_sheets_export.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Ustaw SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const IMPORTS_DIR = path.join(process.cwd(), "imports");

function readCsv(name: string): string[][] {
  const p = path.join(IMPORTS_DIR, name);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => line.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
}

async function main() {
  if (!fs.existsSync(IMPORTS_DIR)) {
    fs.mkdirSync(IMPORTS_DIR, { recursive: true });
    console.log("Utworzono imports/. Wrzuć CSV i uruchom ponownie.");
    return;
  }
  let adminId: string | null = null;
  const { data: prof } = await supabase.from("profiles").select("id").eq("role", "ADMIN").limit(1);
  if (prof?.length) adminId = (prof[0] as { id: string }).id;

  const clients = readCsv("clients.csv");
  const headers = clients[0] ?? [];
  const emailCol = headers.findIndex((h) => /email/i.test(h));
  const companyCol = headers.findIndex((h) => /company|firma/i.test(h));
  for (let i = 1; i < clients.length; i++) {
    const row = clients[i];
    const email = emailCol >= 0 ? row[emailCol] : "";
    if (!email) continue;
    const { data: ex } = await supabase.from("clients").select("id").eq("email", email).limit(1);
    if (ex?.length) continue;
    await supabase.from("clients").insert({
      email: email || null,
      company_name: companyCol >= 0 ? row[companyCol] : null,
      created_by: adminId,
    });
  }
  console.log("clients:", clients.length - 1);

  const offers = readCsv("offers.csv");
  const oHeaders = offers[0] ?? [];
  const numCol = oHeaders.findIndex((h) => /offer_number|numer/i.test(h));
  for (let i = 1; i < offers.length; i++) {
    const row = offers[i];
    const num = numCol >= 0 ? row[numCol] : "";
    const payload: Record<string, string> = {};
    oHeaders.forEach((h, j) => {
      if (row[j] !== undefined) payload[h] = row[j];
    });
    const { data: ex } = await supabase.from("offers").select("id").eq("offer_number", num).limit(1);
    if (ex?.length) continue;
    await supabase.from("offers").insert({
      offer_number: num || null,
      offer_number_status: num ? "FINAL" : "TEMP",
      status: "W_TRAKCIE",
      payload,
      created_by: adminId ?? undefined,
    });
  }
  console.log("offers:", offers.length - 1);

  const base = readCsv("base_pricing.csv");
  if (base.length > 1) {
    const payload: Record<string, unknown> = {
      meta: { version: 1, lastUpdated: new Date().toISOString() },
      cennik: [],
      dodatki: [],
      standard: [],
    };
    const { data: ex } = await supabase.from("base_pricing").select("id").eq("version", 1).limit(1);
    if (!ex?.length) await supabase.from("base_pricing").insert({ version: 1, payload, created_by: adminId });
    console.log("base_pricing: 1");
  }
  console.log("Koniec.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
