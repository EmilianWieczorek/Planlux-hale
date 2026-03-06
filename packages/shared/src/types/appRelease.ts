/**
 * Type for a row in the Supabase app_releases table.
 * Used by the Electron updater for release control.
 * Schema: supabase/migrations/20260306_create_app_releases.sql
 */
export interface AppRelease {
  id: string;
  version: string;
  title?: string;
  changelog?: string;
  download_url: string;
  sha256: string;
  mandatory?: boolean;
  min_supported_version?: string;
  rollout_percent?: number;
  active?: boolean;
  channel?: string;
  created_at?: string;
}
