/**
 * Panel admina – zakładka E-mail: ustawienia globalne, SMTP per handlowiec, outbox, historia.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  Alert,
  IconButton,
  Tabs,
  Tab,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { Add, Edit, Delete, CheckCircle, Refresh, Send } from "@mui/icons-material";
import { tokens } from "../../theme/tokens";

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

type UserRow = { id: string; email: string; role: string; displayName: string; active: boolean };
type SmtpAccount = {
  id: string;
  user_id?: string | null;
  name: string;
  from_name: string;
  from_email: string;
  host: string;
  port: number;
  secure: number;
  auth_user: string;
  reply_to: string | null;
  is_default?: number;
  active?: number;
  hasPassword?: boolean;
};

type OutboxItem = {
  id: string;
  account_id: string | null;
  to_addr: string;
  cc: string | null;
  bcc: string | null;
  subject: string;
  status: string;
  retry_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
};

type HistoryItem = {
  id: string;
  outbox_id: string | null;
  account_id: string | null;
  to_addr: string;
  subject: string;
  status: string;
  provider_message_id: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
};

interface Props {
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

export function AdminEmailTab({ api }: Props) {
  const [subTab, setSubTab] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [globalSettings, setGlobalSettings] = useState({
    office_cc_email: "",
    office_cc_default_enabled: true,
    email_template_subject: "Oferta Planlux – {{offerNumber}}",
    email_template_body_html: "<p>Szanowni Państwo,</p><p>W załączeniu przesyłam ofertę {{offerNumber}}.</p><p>Pozdrawiam,<br>{{salespersonName}}</p>",
  });
  const [loading, setLoading] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [editingAccount, setEditingAccount] = useState<SmtpAccount | null>(null);
  const [formFromName, setFormFromName] = useState("");
  const [formHost, setFormHost] = useState("mail.planlux.pl");
  const [formPort, setFormPort] = useState("587");
  const [formSecure, setFormSecure] = useState(false);
  const [formAuthUser, setFormAuthUser] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formReplyTo, setFormReplyTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" | "info" }>({ open: false, message: "", severity: "info" });
  const [keytarAvailable, setKeytarAvailable] = useState(false);

  const loadGlobalSettings = useCallback(async () => {
    const r = (await api("planlux:settings:getEmailSettings")) as {
      ok: boolean;
      settings?: {
        office_cc_email?: string;
        office_cc_default_enabled?: boolean;
        email_template_subject?: string;
        email_template_body_html?: string;
      };
    };
    if (r.ok && r.settings) {
      setGlobalSettings((prev) => ({
        ...prev,
        office_cc_email: r.settings?.office_cc_email ?? prev.office_cc_email,
        office_cc_default_enabled: r.settings?.office_cc_default_enabled ?? prev.office_cc_default_enabled,
        email_template_subject: r.settings?.email_template_subject ?? prev.email_template_subject,
        email_template_body_html: r.settings?.email_template_body_html ?? prev.email_template_body_html,
      }));
    }
  }, [api]);

  const loadUsers = useCallback(async () => {
    const r = (await api("planlux:getUsers")) as { ok: boolean; users?: UserRow[] };
    if (r.ok && r.users) setUsers(r.users.filter((u) => u.role === "SALESPERSON" && u.active));
    else setUsers([]);
  }, [api]);

  const loadAccounts = useCallback(async () => {
    const r = (await api("planlux:smtp:listAccounts")) as { ok: boolean; accounts?: SmtpAccount[] };
    if (r.ok && r.accounts) setAccounts(r.accounts);
    else setAccounts([]);
  }, [api]);

  const loadOutbox = useCallback(async (status?: string) => {
    const r = (await api("planlux:email:outboxList", status ? { status } : {})) as { ok: boolean; items?: OutboxItem[] };
    if (r.ok && r.items) setOutboxItems(r.items);
    else setOutboxItems([]);
  }, [api]);

  const loadHistory = useCallback(async () => {
    const r = (await api("planlux:email:historyList", 100)) as { ok: boolean; items?: HistoryItem[] };
    if (r.ok && r.items) setHistoryItems(r.items);
    else setHistoryItems([]);
  }, [api]);

  useEffect(() => {
    loadGlobalSettings();
    loadUsers();
    loadAccounts();
    api("planlux:smtp:isKeytarAvailable").then((res) => {
      const r = res as { ok: boolean; available?: boolean };
      setKeytarAvailable(r.available ?? false);
    }).catch(() => {});
  }, [loadGlobalSettings, loadUsers, loadAccounts, api]);

  useEffect(() => {
    if (subTab === 2) loadOutbox();
  }, [subTab, loadOutbox]);

  useEffect(() => {
    if (subTab === 3) loadHistory();
  }, [subTab, loadHistory]);

  const openSmtpForm = (user: UserRow, acc?: SmtpAccount | null) => {
    setEditingUser(user);
    setEditingAccount(acc ?? null);
    setFormFromName(acc?.from_name || user.displayName || "");
    setFormHost(acc?.host || "mail.planlux.pl");
    setFormPort(String(acc?.port || 587));
    setFormSecure(acc?.secure === 1);
    setFormAuthUser(acc?.auth_user || user.email || "");
    setFormPassword("");
    setFormReplyTo(acc?.reply_to || "");
    setAccountModalOpen(true);
  };

  const handleSaveGlobalSettings = async () => {
    setSubmitting(true);
    try {
      const r = (await api("planlux:settings:updateEmailSettings", {
        office_cc_email: globalSettings.office_cc_email.trim(),
        office_cc_default_enabled: globalSettings.office_cc_default_enabled,
        email_template_subject: globalSettings.email_template_subject.trim(),
        email_template_body_html: globalSettings.email_template_body_html.trim(),
      })) as { ok: boolean; error?: string };
      if (r.ok) {
        setSnackbar({ open: true, message: "Ustawienia zapisane", severity: "success" });
        loadGlobalSettings();
      } else {
        setSnackbar({ open: true, message: r.error ?? "Błąd zapisu", severity: "error" });
      }
    } catch (e) {
      setSnackbar({ open: true, message: e instanceof Error ? e.message : "Błąd", severity: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSmtpAccount = async () => {
    if (!editingUser || !formHost.trim()) {
      setSnackbar({ open: true, message: "Host SMTP jest wymagany", severity: "error" });
      return;
    }
    if (!editingAccount?.hasPassword && !formPassword) {
      setSnackbar({ open: true, message: "Hasło jest wymagane przy pierwszej konfiguracji", severity: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const r = (await api("planlux:smtp:upsertForUser", {
        targetUserId: editingUser.id,
        from_name: formFromName.trim(),
        from_email: editingUser.email,
        host: formHost.trim(),
        port: parseInt(formPort, 10) || 587,
        secure: formSecure,
        auth_user: formAuthUser.trim() || editingUser.email,
        smtpPass: formPassword || undefined,
        reply_to: formReplyTo.trim() || undefined,
      })) as { ok: boolean; error?: string };
      if (r.ok) {
        setSnackbar({ open: true, message: "SMTP zapisane", severity: "success" });
        setAccountModalOpen(false);
        loadAccounts();
      } else {
        setSnackbar({ open: true, message: r.error ?? "Błąd zapisu", severity: "error" });
      }
    } catch (e) {
      setSnackbar({ open: true, message: e instanceof Error ? e.message : "Błąd", severity: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestSmtpAccount = async () => {
    if (!editingUser) return;
    setTesting(true);
    try {
      const r = (await api("planlux:smtp:testForUser", editingUser.id)) as { ok: boolean; error?: string };
      if (r.ok) setSnackbar({ open: true, message: "Połączenie OK", severity: "success" });
      else setSnackbar({ open: true, message: r.error ?? "Błąd połączenia", severity: "error" });
    } catch (e) {
      setSnackbar({ open: true, message: e instanceof Error ? e.message : "Błąd", severity: "error" });
    } finally {
      setTesting(false);
    }
  };

  const handleRetryOutbox = async (outboxId: string) => {
    try {
      const r = (await api("planlux:email:retryNow", outboxId)) as { ok: boolean };
      if (r.ok) {
        setSnackbar({ open: true, message: "Dodano do ponownej wysyłki", severity: "success" });
        loadOutbox();
      }
    } catch {
      setSnackbar({ open: true, message: "Błąd", severity: "error" });
    }
  };

  const getAccountForUser = (userId: string) => accounts.find((a) => a.user_id === userId);

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ustawienia e-mail, SMTP per handlowiec (hasła w {keytarAvailable ? "keytar" : "AES"}),
        kolejka outbox i historia wysłanych e-maili.
      </Typography>
      <Tabs value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Ustawienia globalne" />
        <Tab label="SMTP per handlowiec" />
        <Tab label="Kolejka outbox" />
        <Tab label="Historia wysyłek" />
      </Tabs>

      {subTab === 0 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Ustawienia globalne e-mail</h2>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 600 }}>
            <TextField
              label="CC do biura (np. biuro@planlux.pl)"
              value={globalSettings.office_cc_email}
              onChange={(e) => setGlobalSettings((s) => ({ ...s, office_cc_email: e.target.value }))}
              fullWidth
              placeholder="biuro@planlux.pl"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={globalSettings.office_cc_default_enabled}
                  onChange={(e) => setGlobalSettings((s) => ({ ...s, office_cc_default_enabled: e.target.checked }))}
                  color="primary"
                />
              }
              label="Domyślnie włącz CC do biura przy wysyłce"
            />
            <TextField
              label="Szablon tematu"
              value={globalSettings.email_template_subject}
              onChange={(e) => setGlobalSettings((s) => ({ ...s, email_template_subject: e.target.value }))}
              fullWidth
              placeholder="Oferta Planlux – {{offerNumber}}"
            />
            <TextField
              label="Szablon treści (HTML)"
              value={globalSettings.email_template_body_html}
              onChange={(e) => setGlobalSettings((s) => ({ ...s, email_template_body_html: e.target.value }))}
              fullWidth
              multiline
              rows={6}
              placeholder="<p>Szanowni Państwo,</p>..."
            />
            <Button variant="contained" onClick={handleSaveGlobalSettings} disabled={submitting}>
              {submitting ? "Zapisywanie…" : "Zapisz"}
            </Button>
          </Box>
        </div>
      )}

      {subTab === 1 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>SMTP per handlowiec</h2>
          {users.length === 0 ? (
            <Typography color="text.secondary">Brak handlowców (rola SALESPERSON).</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Handlowiec</TableCell>
                  <TableCell>E-mail</TableCell>
                  <TableCell>SMTP</TableCell>
                  <TableCell align="right">Akcje</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => {
                  const acc = getAccountForUser(u.id);
                  const status = acc
                    ? acc.hasPassword
                      ? "Skonfigurowane"
                      : "Brak hasła"
                    : "Brak";
                  return (
                    <TableRow key={u.id}>
                      <TableCell>{u.displayName || u.email}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <Chip
                          label={status}
                          size="small"
                          color={acc?.hasPassword ? "success" : "default"}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {acc && (
                          <IconButton
                            size="small"
                            onClick={async () => {
                              setTesting(true);
                              try {
                                const r = (await api("planlux:smtp:testForUser", u.id)) as { ok: boolean; error?: string };
                                if (r.ok) setSnackbar({ open: true, message: "Połączenie OK", severity: "success" });
                                else setSnackbar({ open: true, message: r.error ?? "Błąd połączenia", severity: "error" });
                              } catch (e) {
                                setSnackbar({ open: true, message: e instanceof Error ? e.message : "Błąd", severity: "error" });
                              } finally {
                                setTesting(false);
                              }
                            }}
                            disabled={testing}
                            title="Test połączenia"
                          >
                            <Refresh fontSize="small" />
                          </IconButton>
                        )}
                        <IconButton size="small" onClick={() => openSmtpForm(u, acc)} title="Konfiguruj SMTP">
                          <Edit fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {subTab === 2 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Kolejka outbox</h2>
          <Box sx={{ mb: 2 }}>
            <Button size="small" onClick={() => loadOutbox()}>Wszystkie</Button>
            <Button size="small" onClick={() => loadOutbox("queued")}>W kolejce</Button>
            <Button size="small" onClick={() => loadOutbox("failed")}>Błędne</Button>
            <Button size="small" onClick={() => loadOutbox("sent")}>Wysłane</Button>
          </Box>
          {outboxItems.length === 0 ? (
            <Typography color="text.secondary">Brak pozycji.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Do</TableCell>
                  <TableCell>Temat</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Data</TableCell>
                  <TableCell>Błąd</TableCell>
                  <TableCell align="right">Akcje</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outboxItems.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.to_addr}</TableCell>
                    <TableCell>{o.subject?.slice(0, 40)}{(o.subject?.length ?? 0) > 40 ? "…" : ""}</TableCell>
                    <TableCell>
                      <Chip
                        label={o.status}
                        size="small"
                        color={o.status === "sent" ? "success" : o.status === "failed" ? "error" : "default"}
                      />
                    </TableCell>
                    <TableCell>{o.created_at ? new Date(o.created_at).toLocaleString("pl-PL") : "—"}</TableCell>
                    <TableCell>{o.last_error ? String(o.last_error).slice(0, 50) : "—"}</TableCell>
                    <TableCell align="right">
                      {(o.status === "queued" || o.status === "failed") && (
                        <Button size="small" startIcon={<Send />} onClick={() => handleRetryOutbox(o.id)}>
                          Ponów
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {subTab === 2 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Historia wysyłek</h2>
          {historyItems.length === 0 ? (
            <Typography color="text.secondary">Brak wpisów.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Do</TableCell>
                  <TableCell>Temat</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Data</TableCell>
                  <TableCell>Błąd</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {historyItems.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{h.to_addr}</TableCell>
                    <TableCell>{h.subject?.slice(0, 40)}{(h.subject?.length ?? 0) > 40 ? "…" : ""}</TableCell>
                    <TableCell>
                      <Chip label={h.status} size="small" color={h.status === "sent" ? "success" : "error"} />
                    </TableCell>
                    <TableCell>{h.created_at ? new Date(h.created_at).toLocaleString("pl-PL") : "—"}</TableCell>
                    <TableCell>{h.error ? String(h.error).slice(0, 50) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <Dialog open={accountModalOpen} onClose={() => !submitting && setAccountModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Konfiguracja SMTP – {editingUser?.displayName || editingUser?.email}</DialogTitle>
        <DialogContent>
          <TextField margin="dense" label="E-mail nadawcy" fullWidth value={editingUser?.email ?? ""} disabled />
          <TextField margin="dense" label="Nazwa nadawcy (from)" fullWidth value={formFromName} onChange={(e) => setFormFromName(e.target.value)} placeholder="np. Paweł Kowalski" />
          <TextField margin="dense" label="Host SMTP" fullWidth required value={formHost} onChange={(e) => setFormHost(e.target.value)} placeholder="mail.planlux.pl" />
          <TextField margin="dense" label="Port" type="number" fullWidth value={formPort} onChange={(e) => setFormPort(e.target.value)} />
          <FormControlLabel
            control={<Checkbox checked={formSecure} onChange={(e) => setFormSecure(e.target.checked)} color="primary" />}
            label="Secure (SSL/TLS)"
          />
          <TextField margin="dense" label="Login (domyślnie e-mail)" fullWidth value={formAuthUser} onChange={(e) => setFormAuthUser(e.target.value)} />
          <TextField
            margin="dense"
            label="Hasło"
            type="password"
            fullWidth
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            placeholder={editingAccount?.hasPassword ? "Zostaw puste, aby nie zmieniać" : "Wymagane przy pierwszej konfiguracji"}
          />
          <TextField margin="dense" label="Reply-To (opcjonalnie)" fullWidth value={formReplyTo} onChange={(e) => setFormReplyTo(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAccountModalOpen(false)} disabled={submitting}>Anuluj</Button>
          <Button onClick={handleTestSmtpAccount} disabled={submitting || testing}>
            {testing ? "Testowanie…" : "Test połączenia"}
          </Button>
          <Button onClick={handleSaveSmtpAccount} variant="contained" disabled={submitting}>
            {submitting ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
