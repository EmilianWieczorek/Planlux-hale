/**
 * Supabase client – main process only. Never in renderer.
 * Uses SUPABASE_URL + SUPABASE_ANON_KEY from config. No service role in app.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig, type AppConfig } from "../config";

let cachedClient: SupabaseClient | null = null;

export function createSupabaseClient(config: AppConfig): SupabaseClient {
  const url = config.supabase?.url?.trim();
  const anonKey = config.supabase?.anonKey?.trim();
  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key required");
  }
  if (cachedClient) return cachedClient;
  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      storageKey: "planlux-supabase-auth",
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}

export function getSupabaseClientOrNull(config: AppConfig): SupabaseClient | null {
  const url = config.supabase?.url?.trim();
  const anonKey = config.supabase?.anonKey?.trim();
  if (!url || !anonKey) return null;
  if (cachedClient) return cachedClient;
  try {
    return createSupabaseClient(config);
  } catch {
    return null;
  }
}

export function clearSupabaseClientCache(): void {
  cachedClient = null;
}

/**
 * Default Supabase client for main process. Uses getConfig() (env + fallbacks).
 * Prefer createSupabaseClient(config) when you already have config.
 */
function getDefaultSupabase(): SupabaseClient {
  return createSupabaseClient(getConfig());
}

export default getDefaultSupabase;
