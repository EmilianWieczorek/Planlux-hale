import { useState, useEffect } from "react";
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Box,
  Snackbar,
  Alert,
} from "@mui/material";
import { Kalkulator } from "../kalkulator/Kalkulator";
import { OfertyView } from "../oferty/OfertyView";
import { DashboardView } from "../dashboard/DashboardView";
import { AdminPanel } from "../admin/AdminPanel";
import { ClearDataDialog } from "./ClearDataDialog";
import { offerDraftStore } from "../../state/offerDraftStore";
import { tokens } from "../../theme/tokens";

type Tab = "dashboard" | "kalkulator" | "oferty" | "admin";

const styles = {
  root: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
  } as React.CSSProperties,
  header: {
    background: tokens.color.navy,
    color: tokens.color.white,
    padding: `${tokens.space[4]} ${tokens.space[6]}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    boxShadow: tokens.shadow.md,
  } as React.CSSProperties,
  title: {
    fontFamily: tokens.font.family,
    fontSize: tokens.font.size.xl,
    fontWeight: tokens.font.weight.semiBold,
  } as React.CSSProperties,
  nav: {
    display: "flex",
    gap: tokens.space[2],
  } as React.CSSProperties,
  navBtn: (active: boolean) =>
    ({
      padding: "8px 16px",
      borderRadius: tokens.radius.md,
      border: "none",
      background: active ? "rgba(255,255,255,0.2)" : "transparent",
      color: tokens.color.white,
      fontSize: tokens.font.size.sm,
      fontWeight: tokens.font.weight.medium,
      cursor: "pointer",
    }) as React.CSSProperties,
  right: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space[4],
  } as React.CSSProperties,
  banner: {
    background: tokens.color.warning,
    color: tokens.color.navy,
    padding: "6px 16px",
    fontSize: 12,
    fontWeight: tokens.font.weight.medium,
  } as React.CSSProperties,
  chip: {
    background: tokens.color.primaryMuted,
    color: tokens.color.primary,
    padding: "4px 10px",
    borderRadius: tokens.radius.full,
    fontSize: 12,
    fontWeight: tokens.font.weight.medium,
  } as React.CSSProperties,
  content: {
    padding: tokens.space[6],
    maxWidth: 1200,
    margin: "0 auto",
  } as React.CSSProperties,
};

interface Props {
  user: { id: string; email: string; role: string; displayName?: string };
  onLogout: () => void;
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

export function MainLayout({ user, onLogout, api }: Props) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const handleTabChange = (newTab: Tab) => {
    offerDraftStore.flushSave();
    setTab(newTab);
  };
  /** Prawdziwy dostęp do internetu (nie tylko LAN) – do bannera i decyzji o wysyłce e-maili. */
  const [hasRealInternet, setHasRealInternet] = useState(true);
  const [outboxCount, setOutboxCount] = useState(0);
  const [clearDialog, setClearDialog] = useState<"global" | "editor" | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailText, setEmailText] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSnackbar, setEmailSnackbar] = useState<{ message: string; severity: "success" | "info" | "error" } | null>(null);

  const isAdmin = user.role === "ADMIN"; // tylko ADMIN widzi Panel admina
  const isBossOrAdmin = user.role === "ADMIN" || user.role === "BOSS"; // widok wszystkich ofert

  const handleClearGlobal = () => {
    offerDraftStore.resetGlobal();
    api("planlux:clearOfferDraft").catch(() => {});
    setClearDialog(null);
  };
  const handleClearEditor = () => {
    offerDraftStore.resetPdfOverrides();
    setClearDialog(null);
  };

  /** Polling co 10 s: real connectivity via window.api.checkInternet (no navigator.onLine). */
  useEffect(() => {
    const check = async () => {
      const checkFn = window.api?.checkInternet ?? (() => api("planlux:checkInternet"));
      const r = (await checkFn()) as { ok?: boolean; online?: boolean };
      setHasRealInternet(r.online ?? false);
    };
    check();
    const t = setInterval(check, 10_000);
    return () => clearInterval(t);
  }, [api]);

  useEffect(() => {
    const load = async () => {
      const r = (await api("planlux:getOutboxCount")) as { count?: number };
      setOutboxCount(r.count ?? 0);
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [api]);

  /** Heartbeat co 90 s (ARCHITECTURE-ULTRA) – loguje typ urządzenia i wersję do outbox + activity. */
  useEffect(() => {
    const enqueue = () => api("planlux:enqueueHeartbeat").catch(() => {});
    enqueue();
    const t = setInterval(enqueue, 90_000);
    return () => clearInterval(t);
  }, [api, user.id]);

  const handleSendEmailSubmit = async () => {
    const to = emailTo.trim();
    const subject = emailSubject.trim();
    const text = emailText.trim();
    if (!to || !subject || !text) {
      setEmailSnackbar({ message: "Uzupełnij: Do, Temat i Treść.", severity: "error" });
      return;
    }
    setEmailSending(true);
    try {
      const send = window.api?.emailSend ?? ((data: unknown) => api("planlux:email:send", data));
      const res = (await send({ to, subject, text })) as { ok?: boolean; queued?: boolean; sent?: boolean; error?: string };
      if (res.ok && res.queued) {
        setEmailSnackbar({
          message: "E-mail trafił do kolejki i zostanie wysłany po powrocie połączenia.",
          severity: "info",
        });
        setEmailDialogOpen(false);
      } else if (res.ok && res.sent) {
        setEmailSnackbar({ message: "E-mail wysłany.", severity: "success" });
        setEmailDialogOpen(false);
        setEmailTo("");
        setEmailSubject("");
        setEmailText("");
      } else if (!res.ok) {
        setEmailSnackbar({ message: res.error ?? "Błąd wysyłki", severity: "error" });
      } else {
        setEmailSnackbar({ message: res.error ?? "Błąd wysyłki", severity: "error" });
      }
    } catch (e) {
      setEmailSnackbar({
        message: e instanceof Error ? e.message : "Błąd wysyłki",
        severity: "error",
      });
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.title}>Planlux Hale</h1>
        <nav style={styles.nav}>
          {(["dashboard", "kalkulator", "oferty"] as const).map((t) => (
            <button key={t} onClick={() => handleTabChange(t)} style={styles.navBtn(tab === t)}>
              {t === "dashboard" ? "Dashboard" : t === "kalkulator" ? "Kalkulator" : "Oferty"}
            </button>
          ))}
          {isAdmin && (
            <button onClick={() => handleTabChange("admin")} style={styles.navBtn(tab === "admin")}>
              Panel admina
            </button>
          )}
        </nav>
        <div style={styles.right}>
          <Button
            size="small"
            sx={{ color: "inherit", textTransform: "none", fontSize: 12 }}
            onClick={() => setClearDialog("editor")}
          >
            Wyczyść edycję PDF
          </Button>
          <Button
            size="small"
            sx={{ color: "inherit", textTransform: "none", fontSize: 12 }}
            onClick={() => setClearDialog("global")}
          >
            Wyczyść dane
          </Button>
          <Button
            size="small"
            sx={{ color: "inherit", textTransform: "none", fontSize: 12 }}
            onClick={() => setEmailDialogOpen(true)}
          >
            Wyślij e-mail
          </Button>
          {!hasRealInternet && <span style={styles.chip}>OFFLINE</span>}
          {outboxCount > 0 && <span style={styles.chip}>{outboxCount} w kolejce</span>}
          <span style={{ fontSize: 12, opacity: 0.9 }}>{user.email}</span>
          <button onClick={onLogout} style={{ ...styles.navBtn(false), background: "transparent" }}>
            Wyloguj
          </button>
        </div>
      </header>
      {!hasRealInternet && (
        <div style={styles.banner}>Brak prawdziwego połączenia z internetem. E-maile trafią do kolejki.</div>
      )}
      <ClearDataDialog
        open={clearDialog !== null}
        mode={clearDialog ?? "global"}
        onClose={() => setClearDialog(null)}
        onConfirm={clearDialog === "global" ? handleClearGlobal : handleClearEditor}
      />
      <Dialog open={emailDialogOpen} onClose={() => !emailSending && setEmailDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Wyślij e-mail</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            <TextField
              label="Do"
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              fullWidth
              required
              placeholder="adres@example.com"
            />
            <TextField
              label="Temat"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Treść"
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              fullWidth
              multiline
              rows={5}
              required
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => !emailSending && setEmailDialogOpen(false)} disabled={emailSending}>
            Anuluj
          </Button>
          <Button variant="contained" onClick={handleSendEmailSubmit} disabled={emailSending}>
            {emailSending ? "Wysyłanie…" : "Wyślij"}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={!!emailSnackbar}
        autoHideDuration={6000}
        onClose={() => setEmailSnackbar(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {emailSnackbar && (
          <Alert severity={emailSnackbar.severity} onClose={() => setEmailSnackbar(null)}>
            {emailSnackbar.message}
          </Alert>
        )}
      </Snackbar>
      <main style={styles.content}>
        {tab === "dashboard" && (
          <DashboardView api={api} userId={user.id} isAdmin={isBossOrAdmin} />
        )}
        {tab === "kalkulator" && (
          <Kalkulator
            api={api}
            userId={user.id}
            userDisplayName={user.displayName}
            online={hasRealInternet}
            onOpenOffer={async (offerId) => {
              handleTabChange("kalkulator");
              const r = (await api("planlux:loadOfferForEdit", offerId)) as { ok: boolean; draft?: unknown };
              if (r.ok && r.draft) offerDraftStore.hydrate(r.draft as Parameters<typeof offerDraftStore.hydrate>[0]);
            }}
          />
        )}
        {tab === "oferty" && (
          <OfertyView
            api={api}
            userId={user.id}
            isAdmin={isBossOrAdmin}
            online={hasRealInternet}
            onEditOffer={async (offerId) => {
              handleTabChange("kalkulator");
              const r = (await api("planlux:loadOfferForEdit", offerId)) as { ok: boolean; draft?: unknown };
              if (r.ok && r.draft) offerDraftStore.hydrate(r.draft as Parameters<typeof offerDraftStore.hydrate>[0]);
            }}
          />
        )}
        {tab === "admin" && isAdmin && <AdminPanel api={api} currentUser={user} />}
      </main>
    </div>
  );
}
