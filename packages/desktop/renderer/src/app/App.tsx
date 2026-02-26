import { useState, useEffect, useRef, useCallback } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { CssBaseline, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Snackbar, Alert } from "@mui/material";
import { planluxTheme } from "../theme/planluxTheme";

const INACTIVITY_MS = 30 * 60 * 1000; // 30 min
const REMINDER_BEFORE_MS = 2 * 60 * 1000; // przypomnienie 2 min przed wylogowaniem
import { LoginScreen } from "../features/auth/LoginScreen";
import { MainLayout } from "../features/layout/MainLayout";
import { offerDraftStore, setSyncErrorHandler } from "../state/offerDraftStore";
import "../theme/global.css";

declare global {
  interface Window {
    planlux?: {
      platform: string;
      version: string;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      onUpdateAvailable?: (cb: (info: { version: string }) => void) => void;
      onUpdateDownloaded?: (cb: () => void) => void;
      downloadUpdate?: () => Promise<unknown>;
      quitAndInstall?: () => Promise<unknown>;
    };
    /** Używane przez main przy before-quit – synchroniczny zapis draftu. */
    __planlux_saveDraft?: () => Promise<void>;
    /** Ustawiane przez App – userId do zapisu w offers_crm. */
    __planlux_userId?: string;
  }
}

const api = (channel: string, ...args: unknown[]) => {
  return window.planlux?.invoke(channel, ...args) ?? Promise.reject(new Error("planlux not available"));
};

export default function App() {
  const [user, setUser] = useState<{ id: string; email: string; role: string; displayName?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [inProgressCount, setInProgressCount] = useState(0);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; downloaded?: boolean } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const lastActivityRef = useRef(Date.now());
  const reminderTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const handleLogin = async (email: string, password: string) => {
    const r = (await api("planlux:login", email, password)) as { ok: boolean; user?: { id: string; email: string; role: string; displayName?: string }; error?: string };
    if (r.ok && r.user) {
      setUser(r.user);
      return true;
    }
    throw new Error(r.error ?? "Login failed");
  };

  const handleLogout = useCallback(async () => {
    setReminderOpen(false);
    if (reminderTimeoutRef.current) {
      clearTimeout(reminderTimeoutRef.current);
      reminderTimeoutRef.current = undefined;
    }
    try {
      await api("planlux:endSession");
    } catch (_) {}
    setUser(null);
  }, []);

  const handleReminderStay = () => {
    lastActivityRef.current = Date.now();
    setReminderOpen(false);
    if (reminderTimeoutRef.current) {
      clearTimeout(reminderTimeoutRef.current);
      reminderTimeoutRef.current = undefined;
    }
  };

  useEffect(() => {
    setLoading(false);
  }, []);

  useEffect(() => {
    window.planlux?.onUpdateAvailable?.((info) => setUpdateInfo({ version: info.version }));
  }, []);
  useEffect(() => {
    window.planlux?.onUpdateDownloaded?.(() =>
      setUpdateInfo((p) => (p ? { ...p, downloaded: true } : { version: "?", downloaded: true }))
    );
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const [draftRes, offersRes] = await Promise.all([
        api("planlux:loadOfferDraft") as Promise<{ ok: boolean; draft?: unknown }>,
        api("planlux:getOffersCrm", user.id, "in_progress", "", user.role === "ADMIN" || user.role === "BOSS") as Promise<{ ok: boolean; offers?: unknown[] }>,
      ]);
      if (cancelled) return;
      if (draftRes.ok && draftRes.draft) offerDraftStore.hydrate(draftRes.draft as Parameters<typeof offerDraftStore.hydrate>[0]);
      if (offersRes.ok && Array.isArray(offersRes.offers)) setInProgressCount(offersRes.offers.length);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    setSyncErrorHandler((msg) => setSyncError(msg));
    return () => setSyncErrorHandler(null);
  }, []);

  useEffect(() => {
    window.__planlux_userId = user?.id ?? "";
    window.__planlux_saveDraft = () => offerDraftStore.flushSave();
    const onBlur = () => offerDraftStore.flushSave();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      delete window.__planlux_saveDraft;
      delete window.__planlux_userId;
    };
  }, [user?.id]);

  // Reset aktywności przy interakcji użytkownika
  useEffect(() => {
    if (!user) return;
    const updateActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => document.addEventListener(e, updateActivity));
    return () => events.forEach((e) => document.removeEventListener(e, updateActivity));
  }, [user]);

  // Sprawdzenie bezczynności co 30 s – pokazanie przypomnienia
  useEffect(() => {
    if (!user) return;
    const iv = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;
      if (elapsed >= INACTIVITY_MS - REMINDER_BEFORE_MS && !reminderOpen) {
        setReminderOpen(true);
      }
    }, 30_000);
    return () => clearInterval(iv);
  }, [user, reminderOpen]);

  // 2 min po przypomnieniu – auto wylogowanie
  useEffect(() => {
    if (!reminderOpen || !user) return;
    reminderTimeoutRef.current = setTimeout(() => {
      handleLogout();
    }, REMINDER_BEFORE_MS);
    return () => {
      if (reminderTimeoutRef.current) {
        clearTimeout(reminderTimeoutRef.current);
      }
    };
  }, [reminderOpen, user, handleLogout]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <span>Ładowanie...</span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <ThemeProvider theme={planluxTheme}>
      <CssBaseline />
      <MainLayout user={user} onLogout={handleLogout} api={api} />
      <Dialog open={inProgressCount > 0} onClose={() => setInProgressCount(0)}>
        <DialogTitle>Niedokończone oferty</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Masz {inProgressCount} {inProgressCount === 1 ? "niedokończoną ofertę" : "niedokończone oferty"} w trakcie. Możesz je dokończyć w zakładce Kalkulator lub Oferty.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInProgressCount(0)}>OK</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!updateInfo} onClose={() => setUpdateInfo(null)}>
        <DialogTitle>Nowa wersja dostępna</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {updateInfo?.downloaded
              ? `Wersja ${updateInfo.version} została pobrana. Kliknij „Uruchom ponownie", aby zaktualizować aplikację.`
              : `Dostępna jest nowa wersja ${updateInfo?.version}. Pobierz i uruchom ponownie, aby zaktualizować.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          {!updateInfo?.downloaded ? (
            <>
              <Button onClick={() => setUpdateInfo(null)}>Później</Button>
              <Button
                variant="contained"
                onClick={async () => {
                  try {
                    await window.planlux?.downloadUpdate?.();
                  } catch (_) {}
                }}
              >
                Pobierz
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setUpdateInfo(null)}>Później</Button>
              <Button
                variant="contained"
                onClick={() => window.planlux?.quitAndInstall?.()}
              >
                Uruchom ponownie
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
      <Snackbar
        open={!!syncError}
        autoHideDuration={5000}
        onClose={() => setSyncError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" onClose={() => setSyncError(null)}>
          {syncError}
        </Alert>
      </Snackbar>
      <Dialog open={reminderOpen} onClose={handleReminderStay}>
        <DialogTitle>Czy nadal jesteś aktywny?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Zostaniesz automatycznie wylogowany za 2 minuty z powodu braku aktywności.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleLogout} color="secondary">
            Wyloguj
          </Button>
          <Button onClick={handleReminderStay} variant="contained">
            Tak, jestem aktywny
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}
