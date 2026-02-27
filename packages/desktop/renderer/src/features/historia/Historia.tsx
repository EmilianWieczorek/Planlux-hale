import { useState, useEffect } from "react";
import { tokens } from "../../theme/tokens";

const styles = {
  tabs: {
    display: "flex",
    gap: tokens.space[2],
    marginBottom: tokens.space[4],
  } as React.CSSProperties,
  tab: (active: boolean) =>
    ({
      padding: "8px 16px",
      borderRadius: tokens.radius.md,
      border: "none",
      background: active ? tokens.color.primary : tokens.color.gray[200],
      color: active ? tokens.color.white : tokens.color.text,
      fontWeight: tokens.font.weight.medium,
      cursor: "pointer",
    }) as React.CSSProperties,
  card: {
    background: tokens.color.white,
    borderRadius: tokens.radius.lg,
    boxShadow: tokens.shadow.md,
    padding: tokens.space[5],
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: tokens.font.size.sm,
  } as React.CSSProperties,
  th: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: `1px solid ${tokens.color.border}`,
    color: tokens.color.textMuted,
    fontWeight: tokens.font.weight.medium,
  } as React.CSSProperties,
  td: {
    padding: "10px 12px",
    borderBottom: `1px solid ${tokens.color.border}`,
  } as React.CSSProperties,
  chipClass: (status: string) => {
    const map: Record<string, string> = {
      LOCAL: "chip chip-ok",
      LOGGED: "chip chip-wysłane",
      "DO_WYSŁANIA": "chip chip-do-wysłania",
      SENT: "chip chip-wysłane",
      FAILED: "chip chip-błąd",
    };
    return map[status] ?? "chip";
  },
};

interface Props {
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
  userId: string;
  isAdmin: boolean;
}

export function Historia({ api, userId, isAdmin }: Props) {
  const [tab, setTab] = useState<"pdf" | "email">("pdf");
  const [pdfs, setPdfs] = useState<Array<{ id: string; client_name: string; created_at: string; status: string; file_path?: string }>>([]);
  const [emails, setEmails] = useState<Array<{ id: string; to_email: string; created_at: string; status: string }>>([]);

  useEffect(() => {
    const load = async () => {
      const r = (await api("planlux:getPdfs")) as { ok: boolean; data?: unknown[] };
      if (r.ok && r.data) setPdfs(r.data as typeof pdfs);
    };
    load();
  }, [api]);

  useEffect(() => {
    const load = async () => {
      const r = (await api("planlux:getEmails")) as { ok: boolean; data?: unknown[] };
      if (r.ok && r.data) setEmails(r.data as typeof emails);
    };
    load();
  }, [api]);

  return (
    <div>
      <div style={styles.tabs}>
        <button onClick={() => setTab("pdf")} style={styles.tab(tab === "pdf")}>
          PDF
        </button>
        <button onClick={() => setTab("email")} style={styles.tab(tab === "email")}>
          E-mail
        </button>
      </div>
      <div style={styles.card}>
        {tab === "pdf" ? (
          pdfs.length === 0 ? (
            <p style={{ color: tokens.color.textMuted }}>Brak wygenerowanych PDF.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Klient</th>
                  <th style={styles.th}>Data</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pdfs.map((p) => (
                  <tr key={p.id}>
                    <td style={styles.td}>{p.client_name}</td>
                    <td style={styles.td}>{new Date(p.created_at).toLocaleString("pl-PL")}</td>
                    <td style={styles.td}>
                      <span className={styles.chipClass(p.status)}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : emails.length === 0 ? (
          <p style={{ color: tokens.color.textMuted }}>Brak wysłanych e-maili.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Do</th>
                <th style={styles.th}>Data</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id}>
                  <td style={styles.td}>{e.to_email}</td>
                  <td style={styles.td}>{new Date(e.created_at).toLocaleString("pl-PL")}</td>
                  <td style={styles.td}>
                    <span className={styles.chipClass(e.status)}>{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
