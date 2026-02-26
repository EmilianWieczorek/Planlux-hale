import { useState, useEffect } from "react";
import { Button } from "@mui/material";
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
  const [online, setOnline] = useState(true);
  const [outboxCount, setOutboxCount] = useState(0);
  const [clearDialog, setClearDialog] = useState<"global" | "editor" | null>(null);

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

  useEffect(() => {
    const check = async () => {
      const r = (await api("planlux:isOnline")) as { online?: boolean };
      setOnline(r.online ?? true);
    };
    check();
    const t = setInterval(check, 15000);
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
    const enqueue = () => api("planlux:enqueueHeartbeat", user.id).catch(() => {});
    enqueue();
    const t = setInterval(enqueue, 90_000);
    return () => clearInterval(t);
  }, [api, user.id]);

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
          {!online && <span style={styles.chip}>OFFLINE</span>}
          {outboxCount > 0 && <span style={styles.chip}>{outboxCount} w kolejce</span>}
          <span style={{ fontSize: 12, opacity: 0.9 }}>{user.email}</span>
          <button onClick={onLogout} style={{ ...styles.navBtn(false), background: "transparent" }}>
            Wyloguj
          </button>
        </div>
      </header>
      {!online && (
        <div style={styles.banner}>Brak połączenia z internetem. E-maile trafią do kolejki.</div>
      )}
      <ClearDataDialog
        open={clearDialog !== null}
        mode={clearDialog ?? "global"}
        onClose={() => setClearDialog(null)}
        onConfirm={clearDialog === "global" ? handleClearGlobal : handleClearEditor}
      />
      <main style={styles.content}>
        {tab === "dashboard" && (
          <DashboardView api={api} userId={user.id} isAdmin={isBossOrAdmin} />
        )}
        {tab === "kalkulator" && (
          <Kalkulator
            api={api}
            userId={user.id}
            userDisplayName={user.displayName}
            online={online}
            onOpenOffer={async (offerId) => {
              handleTabChange("kalkulator");
              const r = (await api("planlux:loadOfferForEdit", offerId, user.id)) as { ok: boolean; draft?: unknown };
              if (r.ok && r.draft) offerDraftStore.hydrate(r.draft as Parameters<typeof offerDraftStore.hydrate>[0]);
            }}
          />
        )}
        {tab === "oferty" && (
          <OfertyView
            api={api}
            userId={user.id}
            isAdmin={isBossOrAdmin}
            online={online}
            onEditOffer={async (offerId) => {
              handleTabChange("kalkulator");
              const r = (await api("planlux:loadOfferForEdit", offerId, user.id)) as { ok: boolean; draft?: unknown };
              if (r.ok && r.draft) offerDraftStore.hydrate(r.draft as Parameters<typeof offerDraftStore.hydrate>[0]);
            }}
          />
        )}
        {tab === "admin" && isAdmin && <AdminPanel api={api} currentUser={user} />}
      </main>
    </div>
  );
}
