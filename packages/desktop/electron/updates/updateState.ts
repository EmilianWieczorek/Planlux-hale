/**
 * Central update state and renderer notification.
 */

import type { UpdateState as State, UpdateStatus, ReleaseInfo, DownloadProgress } from "./types";

let state: State = {
  status: "idle",
  release: null,
  error: null,
  downloadProgress: null,
};

type NotifySend = (channel: string, payload?: unknown) => void;
let notifySend: NotifySend | null = null;

export function setNotifySend(send: NotifySend | null): void {
  notifySend = send;
}

export function getState(): State {
  return { ...state };
}

function emit(channel: string, payload?: unknown): void {
  try {
    notifySend?.(channel, payload);
  } catch {
    // ignore
  }
}

export function setStatus(status: UpdateStatus, release?: ReleaseInfo | null, error?: string | null): void {
  state = {
    ...state,
    status,
    release: release !== undefined ? release : state.release,
    error: error !== undefined ? error : (status === "error" ? state.error : null),
    downloadProgress: status === "downloading" ? state.downloadProgress : null,
  };
  if (status === "checking") emit("planlux:update:checking");
  if (status === "available" && state.release) emit("planlux:update:available", { release: state.release, version: state.release.version });
  if (status === "error") emit("planlux:update:error", { message: state.error ?? "Unknown error" });
  if (status === "downloaded" && state.release) emit("planlux:update:downloaded", { version: state.release.version });
}

export function setDownloadProgress(progress: DownloadProgress): void {
  state = { ...state, downloadProgress: progress };
  emit("planlux:update:progress", progress);
}
