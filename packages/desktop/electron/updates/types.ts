/**
 * Types for custom auto-update system (Supabase release control + Storage installer).
 */

export interface ReleaseInfo {
  version: string;
  title: string;
  changelog: string;
  download_url: string;
  sha256: string;
  mandatory: boolean;
  min_supported_version: string | null;
  rollout_percent: number;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  release: ReleaseInfo | null;
  error: string | null;
  downloadProgress: DownloadProgress | null;
}

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number | null;
  transferred: number;
  total: number | null;
}

export interface UpdateResult {
  updateAvailable: boolean;
  release: ReleaseInfo | null;
  currentVersion: string;
  error?: string;
}
