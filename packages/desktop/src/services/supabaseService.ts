/**
 * Fetch pricing and config tables from Supabase.
 * Used by configSync to download and cache locally.
 */

import { supabase } from "../lib/supabase";

export async function getPricingSurface(): Promise<unknown[]> {
  const { data, error } = await supabase.from("pricing_surface").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function getAddons(): Promise<unknown[]> {
  const { data, error } = await supabase.from("addons_surcharges").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function getStandardIncluded(): Promise<unknown[]> {
  const { data, error } = await supabase.from("standard_included").select("*");
  if (error) throw error;
  return data ?? [];
}

export interface MetaRow {
  version: number;
  last_updated?: string;
}

export async function getMetaVersion(): Promise<MetaRow | null> {
  const { data, error } = await supabase.from("meta").select("version, last_updated").limit(1).maybeSingle();
  if (error) throw error;
  if (!data || typeof (data as MetaRow).version !== "number") return null;
  return data as MetaRow;
}
