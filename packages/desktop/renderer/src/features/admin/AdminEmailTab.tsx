/**
 * Panel admina – zakładka E-mail: konta SMTP, outbox, historia.
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

type SmtpAccount = {
  id: string;
  name: string;
  from_name: string;
  from_email: string;
  host: string;
  port: number;
  secure: number;
  auth_user: string;
  reply_to: string | null;
  is_default: number;
  active: number;
  created_at: string;
  updated_at: string;
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
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SmtpAccount | null>(null);
  const [formName, setFormName] = useState("");
  const [formFromName, setFormFromName] = useState("");
  const [formFromEmail, setFormFromEmail] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("587");
  const [formSecure, setFormSecure] = useState(false);
  const [formAuthUser, setFormAuthUser] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formReplyTo, setFormReplyTo] = useState("");
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" | "info" }>({ open: false, message: "", severity: "info" });
  const [keytarAvailable, setKeytarAvailable] = useState(false);

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
    loadAccounts();
    api("planlux:smtp:isKeytarAvailable").then((res) => {
      const r = res as { ok: boolean; available?: boolean };
      setKeytarAvailable(r.available ?? false);
    }).catch(() => {});
  }, [loadAccounts, api]);

  useEffect(() => {
    if (subTab === 1) loadOutbox();
  }, [subTab, loadOutbox]);

  useEffect(() => {
    if (subTab === 2) loadHistory();
  }, [subTab, loadHistory]);

  const openCreateAccount = () => {
    setEditingAccount(null);
    setFormName("");
    setFormFromName("");
    setFormFromEmail("");
    setFormHost("");
    setFormPort("587");
    setFormSecure(false);
    setFormAuthUser("");
    setFormPassword("");
    setFormReplyTo("");
    setFormIsDefault(accounts.length === 0);
    setAccountModalOpen(true);
  };

  const openEditAccount = (a: SmtpAccount) => {
    setEditingAccount(a);
    setFormName(a.name || "");
    setFormFromName(a.from_name || "");
    setFormFromEmail(a.from_email || "");
    setFormHost(a.host || "");
    setFormPort(String(a.port || 587));
    setFormSecure(a.secure === 1);
    setFormAuthUser(a.auth_user || "");
    setFormPassword("");
    setFormReplyTo(a.reply_to || "");
    setFormIsDefault(a.is_default === 1);
    setAccountModalOpen(true);
  };

  const handleSaveAccount = async () => {
    if (!formFromEmail.trim() || !formHost.trim()) {
      setSnackbar({ open: true, message: "E-mail nadawcy i host SMTP są wymagane", severity: "error" });
      return;
    }
    if (!editingAccount && !formPassword) {
      setSnackbar({ open: true, message: "Hasło jest wymagane przy tworzeniu konta", severity: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const r = (await api("planlux:smtp:upsertAccount", {
        id: editingAccount?.id,
        name: formName.trim(),
        from_name: formFromName.trim(),
        from_email: formFromEmail.trim(),
        host: formHost.trim(),
        port: parseInt(formPort, 10) || 587,
        secure: formSecure,
        auth_user: formAuthUser.trim() || formFromEmail.trim(),
        password: formPassword || undefined,
        reply_to: formReplyTo.trim() || undefined,
        is_default: formIsDefault,
      })) as { ok: boolean; error?: string };
      if (r.ok) {
        setSnackbar({ open: true, message: editingAccount ? "Konto zaktualizowane" : "Konto dodane", severity: "success" });
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

  const handleSetDefault = async (id: string) => {
    try {
      const r = (await api("planlux:smtp:setDefaultAccount", id)) as { ok: boolean };
      if (r.ok) {
        setSnackbar({ open: true, message: "Ustawiono domyślne konto", severity: "success" });
        loadAccounts();
      }
    } catch {
      setSnackbar({ open: true, message: "Błąd", severity: "error" });
    }
  };

  const handleTestAccount = async (id: string) => {
    setTesting(true);
    try {
      const r = (await api("planlux:smtp:testAccount", id)) as { ok: boolean; error?: string };
      if (r.ok) setSnackbar({ open: true, message: "Połączenie OK", severity: "success" });
      else setSnackbar({ open: true, message: r.error ?? "Błąd połączenia", severity: "error" });
    } catch (e) {
      setSnackbar({ open: true, message: e instanceof Error ? e.message : "Błąd", severity: "error" });
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm("Usunąć to konto SMTP? Hasło zostanie usunięte z magazynu.")) return;
    try {
      const r = (await api("planlux:smtp:deleteAccount", id)) as { ok: boolean };
      if (r.ok) {
        setSnackbar({ open: true, message: "Konto usunięte", severity: "success" });
        loadAccounts();
      }
    } catch {
      setSnackbar({ open: true, message: "Błąd", severity: "error" });
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

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Konta SMTP (hasła w magazynie systemowym {keytarAvailable ? "keytar" : "AES"}),
        kolejka outbox i historia wysłanych e-maili.
      </Typography>
      <Tabs value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Konta SMTP" />
        <Tab label="Kolejka outbox" />
        <Tab label="Historia wysyłek" />
      </Tabs>

      {subTab === 0 && (
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={styles.h2}>Konta SMTP</h2>
            <Button variant="contained" startIcon={<Add />} onClick={openCreateAccount}>
              Dodaj konto
            </Button>
          </div>
          {accounts.length === 0 ? (
            <Typography color="text.secondary">Brak kont. Dodaj konto SMTP, aby wysyłać e-maile z aplikacji.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nazwa / Od</TableCell>
                  <TableCell>Host</TableCell>
                  <TableCell>Domyślne</TableCell>
                  <TableCell align="right">Akcje</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      {a.name || a.from_email}
                      {a.from_name && <Typography variant="caption" display="block">{a.from_email}</Typography>}
                    </TableCell>
                    <TableCell>{a.host}:{a.port}</TableCell>
                    <TableCell>
                      {a.is_default === 1 ? (
                        <Chip label="Domyślne" size="small" color="primary" />
                      ) : (
                        <Button size="small" onClick={() => handleSetDefault(a.id)}>Ustaw domyślne</Button>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => handleTestAccount(a.id)} disabled={testing} title="Test połączenia">
                        <Refresh fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => openEditAccount(a)} title="Edytuj">
                        <Edit fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDeleteAccount(a.id)} title="Usuń">
                        <Delete fontSize="small" color="error" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {subTab === 1 && (
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
        <DialogTitle>{editingAccount ? "Edytuj konto SMTP" : "Dodaj konto SMTP"}</DialogTitle>
        <DialogContent>
          <TextField margin="dense" label="Nazwa (opcjonalnie)" fullWidth value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="np. Planlux" />
          <TextField margin="dense" label="Nazwa nadawcy" fullWidth value={formFromName} onChange={(e) => setFormFromName(e.target.value)} placeholder="Planlux Hale" />
          <TextField margin="dense" label="E-mail nadawcy" type="email" fullWidth required value={formFromEmail} onChange={(e) => setFormFromEmail(e.target.value)} />
          <TextField margin="dense" label="Host SMTP" fullWidth required value={formHost} onChange={(e) => setFormHost(e.target.value)} placeholder="smtp.example.com" />
          <TextField margin="dense" label="Port" type="number" fullWidth value={formPort} onChange={(e) => setFormPort(e.target.value)} />
          <TextField margin="dense" label="Login (opcjonalnie, domyślnie e-mail)" fullWidth value={formAuthUser} onChange={(e) => setFormAuthUser(e.target.value)} />
          <TextField
            margin="dense"
            label="Hasło"
            type="password"
            fullWidth
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            placeholder={editingAccount ? "Zostaw puste, aby nie zmieniać" : ""}
            required={!editingAccount}
          />
          <TextField margin="dense" label="Reply-To (opcjonalnie)" fullWidth value={formReplyTo} onChange={(e) => setFormReplyTo(e.target.value)} />
          <Button size="small" onClick={() => setFormIsDefault(!formIsDefault)}>
            {formIsDefault ? "✓ Domyślne konto" : "Ustaw jako domyślne"}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAccountModalOpen(false)} disabled={submitting}>Anuluj</Button>
          <Button onClick={handleSaveAccount} variant="contained" disabled={submitting}>
            {submitting ? "Zapisywanie…" : editingAccount ? "Zapisz" : "Dodaj"}
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
