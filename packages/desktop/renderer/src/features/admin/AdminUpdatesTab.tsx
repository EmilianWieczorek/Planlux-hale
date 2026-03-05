/**
 * Panel admina – zakładka Aktualizacje: wersja, sprawdzanie aktualizacji (PLANLUX_UPDATES_URL).
 */
import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
  Snackbar,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
} from "@mui/material";
import { GetApp, Refresh } from "@mui/icons-material";
import { tokens } from "../../theme/tokens";

type VersionResponse = {
  ok: boolean;
  latest?: string;
  minSupported?: string;
  force?: boolean;
  message?: string;
  downloadUrl?: string;
  checkIntervalMin?: number;
  serverTime?: string;
};

type HistoryItem = {
  version: string;
  date: string;
  title: string;
  message: string;
  force?: boolean;
  downloadUrl?: string;
};

type HistoryResponse = {
  ok: boolean;
  items?: HistoryItem[];
};

const styles = {
  card: {
    background: tokens.color.white,
    borderRadius: tokens.radius.lg,
    boxShadow: tokens.shadow.md,
    padding: tokens.space[5],
    marginBottom: tokens.space[4],
  } as React.CSSProperties,
  h2: { marginTop: 0 } as React.CSSProperties,
};

interface Props {
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

export function AdminUpdatesTab({ api }: Props) {
  const [currentVersion, setCurrentVersion] = useState("");
  const [updatesUrl, setUpdatesUrl] = useState("");
  const [versionInfo, setVersionInfo] = useState<VersionResponse | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFetchFailed, setHistoryFetchFailed] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" | "info" }>({
    open: false,
    message: "",
    severity: "info",
  });

  const getVersion = useCallback(async () => {
    try {
      const r = (await api("planlux:updates:getCurrentVersion")) as { ok: boolean; version?: string };
      if (r.ok && r.version) setCurrentVersion(r.version);
    } catch {
      setCurrentVersion("—");
    }
  }, [api]);

  const getUpdatesUrl = useCallback(async () => {
    try {
      const r = (await api("planlux:updates:getUpdatesUrl")) as { ok: boolean; updatesUrl?: string };
      if (r.ok && typeof r.updatesUrl === "string") setUpdatesUrl(r.updatesUrl.trim());
    } catch {
      setUpdatesUrl("");
    }
  }, [api]);

  const fetchVersion = useCallback(async (): Promise<VersionResponse | null> => {
    if (!updatesUrl) return null;
    try {
      const url = `${updatesUrl}${updatesUrl.includes("?") ? "&" : "?"}action=version`;
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const data = (await res.json()) as VersionResponse;
      return data?.ok ? data : null;
    } catch {
      return null;
    }
  }, [updatesUrl]);

  const fetchHistory = useCallback(async (): Promise<HistoryItem[]> => {
    if (!updatesUrl) return [];
    const url = `${updatesUrl}${updatesUrl.includes("?") ? "&" : "?"}action=history`;
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error("History fetch failed");
    const data = (await res.json()) as HistoryResponse;
    return Array.isArray(data?.items) ? data.items : [];
  }, [updatesUrl]);

  /** Refresh version info for display and trigger global check (banner/modal in MainLayout). */
  const loadVersionCheck = useCallback(async () => {
    if (!updatesUrl) return;
    setLoadingVersion(true);
    try {
      const [data, versionRes] = await Promise.all([fetchVersion(), api("planlux:updates:getCurrentVersion")]);
      const cur = (versionRes as { ok: boolean; version?: string })?.version ?? "";
      if (cur) setCurrentVersion(cur);
      setVersionInfo(data ?? null);
      window.dispatchEvent(new CustomEvent("planlux-run-update-check"));
    } finally {
      setLoadingVersion(false);
    }
  }, [updatesUrl, fetchVersion, api]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryFetchFailed(false);
    try {
      const items = await fetchHistory();
      setHistoryItems(items.slice(0, Math.max(10, items.length)));
    } catch {
      setHistoryFetchFailed(true);
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [fetchHistory]);

  useEffect(() => {
    getVersion();
    getUpdatesUrl();
  }, [getVersion, getUpdatesUrl]);

  /** Auto-check runs in MainLayout 5s after app start. Here we only load history when tab is open. */

  useEffect(() => {
    if (updatesUrl) loadHistory();
  }, [updatesUrl, loadHistory]);

  const openDownload = useCallback(
    async (url: string | undefined) => {
      const toOpen = url || versionInfo?.downloadUrl || "";
      if (!toOpen) {
        setSnackbar({ open: true, message: "Brak linku do pobrania", severity: "info" });
        return;
      }
      try {
        const r = (await api("planlux:updates:openExternal", toOpen)) as { ok: boolean; error?: string };
        if (r.ok) setSnackbar({ open: true, message: "Otwieranie linku…", severity: "success" });
        else setSnackbar({ open: true, message: r.error ?? "Błąd", severity: "error" });
      } catch (e) {
        setSnackbar({ open: true, message: e instanceof Error ? e.message : "Błąd", severity: "error" });
      }
    },
    [api, versionInfo?.downloadUrl]
  );

  const historyEntryFor = useCallback(
    (ver: string) => historyItems.find((h) => h.version === ver),
    [historyItems]
  );

  return (
    <Box>
      <div style={styles.card}>
        <h2 style={styles.h2}>Aktualizacje</h2>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Aktualna wersja aplikacji i historia wydań z serwera aktualizacji.
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", mb: 2 }}>
          <Typography variant="body1">
            <strong>Aktualna wersja:</strong> {currentVersion || "—"}
          </Typography>
          {versionInfo?.latest && (
            <Typography variant="body1" color="text.secondary">
              Najnowsza wersja: {versionInfo.latest}
            </Typography>
          )}
          <Button
            size="small"
            startIcon={<Refresh />}
            onClick={() => loadVersionCheck()}
            disabled={loadingVersion || !updatesUrl}
          >
            Sprawdź aktualizacje
          </Button>
          {versionInfo?.downloadUrl && (
            <Button
              size="small"
              variant="contained"
              startIcon={<GetApp />}
              onClick={() => openDownload(versionInfo.downloadUrl)}
            >
              Pobierz najnowszą wersję
            </Button>
          )}
        </Box>

        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
          Historia aktualizacji
        </Typography>
        {!updatesUrl ? (
          <Typography color="text.secondary">Skonfiguruj PLANLUX_UPDATES_URL, aby pobrać historię.</Typography>
        ) : loadingHistory ? (
          <Typography color="text.secondary">Ładowanie…</Typography>
        ) : historyFetchFailed || historyItems.length === 0 ? (
          <Typography color="text.secondary">
            {historyFetchFailed ? "Brak danych historii (offline)." : "Brak wpisów."}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Wersja</TableCell>
                <TableCell>Data</TableCell>
                <TableCell>Tytuł</TableCell>
                <TableCell>Opis</TableCell>
                <TableCell align="right">Akcje</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {historyItems.map((item, i) => (
                <TableRow key={`${item.version}-${i}`}>
                  <TableCell>
                    {item.version}
                    {item.force && (
                      <Chip label="FORCE" size="small" color="error" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>{item.date || "—"}</TableCell>
                  <TableCell>{item.title || "—"}</TableCell>
                  <TableCell>{item.message ? String(item.message).slice(0, 60) + (item.message.length > 60 ? "…" : "") : "—"}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      startIcon={<GetApp />}
                      onClick={() => openDownload(item.downloadUrl || versionInfo?.downloadUrl)}
                    >
                      Pobierz
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
