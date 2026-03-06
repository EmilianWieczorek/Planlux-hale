/**
 * Fetches release info from Supabase and determines update availability.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { compareVersions } from "./version";
import type { ReleaseInfo, UpdateResult } from "./types";

const STABLE_CHANNEL = "stable";

export interface CheckForUpdatesDeps {
  getVersion: () => string;
  getSupabase: () => SupabaseClient;
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void };
}

function rowToRelease(row: Record<string, unknown>): ReleaseInfo {
  return {
    version: String(row.version ?? ""),
    title: String(row.title ?? ""),
    changelog: String(row.changelog ?? ""),
    download_url: String(row.download_url ?? ""),
    sha256: String(row.sha256 ?? ""),
    mandatory: Boolean(row.mandatory),
    min_supported_version: row.min_supported_version != null ? String(row.min_supported_version) : null,
    rollout_percent: Number(row.rollout_percent) || 0,
  };
}

/**
 * Fetch latest release from Supabase app_releases (active = true, channel = 'stable').
 * Compare with current version; return update availability.
 */
export async function checkForUpdates(deps: CheckForUpdatesDeps): Promise<UpdateResult> {
  const currentVersion = deps.getVersion();
  deps.logger.info("[updates] checking");

  try {
    const supabase = deps.getSupabase();
    // Selected columns match Supabase table app_releases (same names; no mapping).
    const { data, error } = await supabase
      .from("app_releases")
      .select("version, title, changelog, download_url, sha256, mandatory, min_supported_version, rollout_percent")
      .eq("active", true)
      .eq("channel", STABLE_CHANNEL)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      deps.logger.warn("[updates] fetch releases failed", { message: error.message });
      return { updateAvailable: false, release: null, currentVersion, error: error.message };
    }

    if (!data || typeof data !== "object") {
      return { updateAvailable: false, release: null, currentVersion };
    }

    const release = rowToRelease(data as Record<string, unknown>);
    if (!release.version || !release.download_url || !release.sha256) {
      deps.logger.warn("[updates] release missing version/download_url/sha256", { version: release.version });
      return { updateAvailable: false, release: null, currentVersion };
    }

    const cmp = compareVersions(release.version, currentVersion);
    if (cmp <= 0) {
      deps.logger.info("[updates] no update", { current: currentVersion, latest: release.version });
      return { updateAvailable: false, release: null, currentVersion };
    }

    deps.logger.info("[updates] available", { version: release.version });
    return { updateAvailable: true, release, currentVersion };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.logger.error("[updates] check failed", e);
    return { updateAvailable: false, release: null, currentVersion, error: message };
  }
}
