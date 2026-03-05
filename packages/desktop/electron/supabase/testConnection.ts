/**
 * Verifies Supabase connectivity by querying the profiles table.
 * Used by IPC planlux:testSupabaseConnection.
 */

import { getConfig } from "../config";
import { createSupabaseClient } from "./client";
import { logger } from "../logger";
import { AppError } from "../errors/AppError";

function isProfilesSchemaMissing(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    (lower.includes("could not find table") || lower.includes("schema cache")) &&
    lower.includes("profiles")
  );
}

export async function testSupabaseConnection(): Promise<{ ok: true; data?: unknown } | { ok: false; error: string }> {
  const log = logger.child("supabase");
  try {
    const config = getConfig();
    const supabase = createSupabaseClient(config);
    const { data, error } = await supabase.from("profiles").select("id").limit(1);

    if (error) {
      const msg = error.message ?? "Supabase error";
      if (isProfilesSchemaMissing(msg)) {
        throw new AppError(
          "SUPABASE_SCHEMA_MISSING",
          "Brakuje tabeli profiles w Supabase. Uruchom migracje.",
          { expose: true, details: { hint: "Run: supabase db push" } }
        );
      }
      log.error("Supabase connection test failed", { errorMessage: msg });
      return { ok: false, error: msg };
    }

    log.info("Supabase connection OK");
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isProfilesSchemaMissing(message)) {
      throw new AppError(
        "SUPABASE_SCHEMA_MISSING",
        "Brakuje tabeli profiles w Supabase. Uruchom migracje.",
        { expose: true, details: { hint: "Run: supabase db push" } }
      );
    }
    log.error("Supabase connection test failed", { error: message });
    return { ok: false, error: message };
  }
}
