import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
} from "@mui/material";
import { FolderOpen } from "@mui/icons-material";

type DiagnosticsData = {
  ok: boolean;
  appVersion?: string;
  userRole?: string;
  dbPath?: string;
  pricingEntries?: number;
  uniqueVariants?: number;
  lastSyncStatus?: string;
  seedDbUsed?: string;
  logPath?: string;
  error?: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
  selectedVariant?: string | null;
  onExportLogs?: (path: string) => void;
}

export function DiagnosticsPanel({ open, onClose, api, selectedVariant, onExportLogs }: Props) {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setData(null);
    try {
      const r = (await api("planlux:getDiagnosticsPanelData")) as DiagnosticsData;
      setData(r);
    } catch (e) {
      setData({ ok: false, error: String(e) });
    } finally {
      setLoading(false);
    }
  }, [open, api]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleExportLogs = async () => {
    setExportMessage(null);
    try {
      const r = (await api("planlux:openLogsFolder")) as { ok: boolean; path?: string; error?: string };
      if (r.ok && r.path) {
        setExportMessage("Folder z logami został otwarty.");
        onExportLogs?.(r.path);
      } else {
        setExportMessage(r.error ?? "Nie udało się otworzyć folderu.");
      }
    } catch (e) {
      setExportMessage(String(e));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Diagnostyka</DialogTitle>
      <DialogContent>
        {loading && (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        )}
        {!loading && data && (
          <Box sx={{ "& > *": { mb: 1.5 } }}>
            <Typography variant="body2" color="text.secondary">
              <strong>Wersja aplikacji:</strong> {data.appVersion ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Rola użytkownika:</strong> {data.userRole ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
              <strong>Ścieżka bazy:</strong> {data.dbPath ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Wpisy cennika:</strong> {data.pricingEntries ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Unikalne warianty:</strong> {data.uniqueVariants ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Wybrany wariant:</strong> {selectedVariant ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Ostatnia synchronizacja:</strong> {data.lastSyncStatus ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
              <strong>Seed DB:</strong> {data.seedDbUsed ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
              <strong>Plik logów:</strong> {data.logPath ?? "—"}
            </Typography>
            {exportMessage && (
              <Alert severity={exportMessage.startsWith("Folder") ? "success" : "warning"} sx={{ mt: 1 }}>
                {exportMessage}
              </Alert>
            )}
          </Box>
        )}
        {!loading && data && !data.ok && data.error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {data.error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleExportLogs} startIcon={<FolderOpen />} color="primary">
          Eksportuj logi (otwórz folder)
        </Button>
        <Button onClick={onClose}>Zamknij</Button>
      </DialogActions>
    </Dialog>
  );
}
