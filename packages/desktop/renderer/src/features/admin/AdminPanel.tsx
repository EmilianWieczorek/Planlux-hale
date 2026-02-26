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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Snackbar,
  Alert,
  IconButton,
  Tabs,
  Tab,
} from "@mui/material";
import { Add, Edit, Block, CheckCircle, People, Timeline, PictureAsPdf, Email } from "@mui/icons-material";
import { tokens } from "../../theme/tokens";

const styles = {
  card: {
    background: tokens.color.white,
    borderRadius: tokens.radius.lg,
    boxShadow: tokens.shadow.md,
    padding: tokens.space[5],
    marginBottom: tokens.space[4],
  } as React.CSSProperties,
  h2: {
    marginTop: 0,
  } as React.CSSProperties,
};

type UserRow = { id: string; email: string; role: string; displayName: string; active: boolean; createdAt: string };
type ActivityRow = { id: string; user_id: string; device_type: string; app_version: string; occurred_at: string; user_display_name?: string; user_email?: string };
type PdfRow = { id: string; user_id: string; client_name: string; created_at: string; status: string; file_name?: string; user_display_name?: string };
type EmailRow = { id: string; user_id: string; to_email: string; created_at: string; status: string; error_message?: string; user_display_name?: string };

interface Props {
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
  currentUser: { id: string; email: string; role: string; displayName?: string };
}

export function AdminPanel({ api, currentUser }: Props) {
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [pdfs, setPdfs] = useState<PdfRow[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formRole, setFormRole] = useState<string>("SALESPERSON");
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" | "info" }>({ open: false, message: "", severity: "info" });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const r = (await api("planlux:getUsers")) as { ok: boolean; users?: UserRow[] };
      if (r.ok && r.users) setUsers(r.users);
      else setUsers([]);
    } catch {
      setUsers([]);
      setSnackbar({ open: true, message: "Błąd ładowania użytkowników", severity: "error" });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const loadActivity = async () => {
    try {
      const r = (await api("planlux:getActivity", currentUser.id, true)) as { ok: boolean; data?: ActivityRow[] };
      if (r.ok && r.data) setActivity(r.data);
      else setActivity([]);
    } catch {
      setActivity([]);
    }
  };

  const loadHistory = async () => {
    try {
      const [pRes, eRes] = await Promise.all([
        api("planlux:getPdfs", currentUser.id, true),
        api("planlux:getEmails", currentUser.id, true),
      ]);
      const p = pRes as { ok: boolean; data?: PdfRow[] };
      const e = eRes as { ok: boolean; data?: EmailRow[] };
      if (p.ok && p.data) setPdfs(p.data);
      else setPdfs([]);
      if (e.ok && e.data) setEmails(e.data);
      else setEmails([]);
    } catch {
      setPdfs([]);
      setEmails([]);
    }
  };

  useEffect(() => {
    if (tab === 1) loadActivity();
  }, [api, currentUser.id, tab]);

  useEffect(() => {
    if (tab === 2 || tab === 3) loadHistory();
  }, [api, currentUser.id, tab]);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormEmail("");
    setFormPassword("");
    setFormDisplayName("");
    setFormRole("SALESPERSON");
    setModalOpen(true);
  };

  const openEditModal = (u: UserRow) => {
    setEditingUser(u);
    setFormEmail(u.email);
    setFormPassword("");
    setFormDisplayName(u.displayName || "");
    setFormRole(u.role);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const email = formEmail.trim().toLowerCase();
    if (!email) {
      setSnackbar({ open: true, message: "Email jest wymagany", severity: "error" });
      return;
    }
    if (!editingUser && formPassword.length < 4) {
      setSnackbar({ open: true, message: "Hasło musi mieć min. 4 znaki", severity: "error" });
      return;
    }
    if (!currentUser?.id) {
      setSnackbar({ open: true, message: "Brak sesji — odśwież stronę i zaloguj się ponownie", severity: "error" });
      return;
    }
    setSubmitting(true);
    try {
      if (editingUser) {
        const payload: { email?: string; displayName?: string; role?: string; password?: string } = {
          email,
          displayName: formDisplayName.trim() || undefined,
          role: formRole,
        };
        if (formPassword.length > 0) payload.password = formPassword;
        const r = (await api("planlux:updateUser", currentUser.id, editingUser.id, payload)) as { ok: boolean; error?: string };
        if (r.ok) {
          setSnackbar({ open: true, message: "Użytkownik zaktualizowany", severity: "success" });
          setModalOpen(false);
          loadUsers();
        } else {
          setSnackbar({ open: true, message: r.error ?? "Błąd aktualizacji", severity: "error" });
        }
      } else {
        const r = (await api("planlux:createUser", currentUser.id, {
          email,
          password: formPassword,
          displayName: formDisplayName.trim() || undefined,
          role: formRole,
        })) as { ok: boolean; error?: string };
        if (r.ok) {
          setSnackbar({ open: true, message: "Użytkownik utworzony", severity: "success" });
          setModalOpen(false);
          loadUsers();
        } else {
          setSnackbar({ open: true, message: r.error ?? "Błąd tworzenia", severity: "error" });
        }
      }
    } catch (e) {
      const err = e as Error & { code?: string; cause?: unknown };
      const msg = err?.message ?? String(e);
      const code = err?.code ? ` [${err.code}]` : "";
      if (import.meta.env.DEV) {
        console.error("[AdminPanel] createUser/updateUser failed", e);
      }
      setSnackbar({ open: true, message: msg + code || "Błąd zapisu", severity: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisable = async (u: UserRow, active: boolean) => {
    if (u.id === currentUser.id) {
      setSnackbar({ open: true, message: "Nie możesz wyłączyć własnego konta", severity: "error" });
      return;
    }
    try {
      const r = (await api("planlux:disableUser", currentUser.id, u.id, active)) as { ok: boolean; error?: string };
      if (r.ok) {
        setSnackbar({ open: true, message: active ? "Użytkownik włączony" : "Użytkownik wyłączony", severity: "success" });
        loadUsers();
      } else {
        setSnackbar({ open: true, message: r.error ?? "Błąd", severity: "error" });
      }
    } catch (e) {
      setSnackbar({ open: true, message: e instanceof Error ? e.message : "Błąd", severity: "error" });
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Panel admina
      </Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab icon={<People />} iconPosition="start" label="Użytkownicy" />
        <Tab icon={<Timeline />} iconPosition="start" label="Aktywność" />
        <Tab icon={<PictureAsPdf />} iconPosition="start" label="Historia PDF" />
        <Tab icon={<Email />} iconPosition="start" label="Historia e-mail" />
      </Tabs>

      {tab === 0 && (
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={styles.h2}>Użytkownicy</h2>
            <Button variant="contained" startIcon={<Add />} onClick={openCreateModal}>
              Dodaj użytkownika
            </Button>
          </div>
          <p style={{ color: tokens.color.textMuted, marginBottom: 16 }}>
            Zarządzanie użytkownikami w lokalnej bazie SQLite.
          </p>
          {loading ? (
            <Typography color="text.secondary">Ładowanie...</Typography>
          ) : users.length === 0 ? (
            <Typography color="text.secondary">Brak użytkowników.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Rola</TableCell>
                  <TableCell>Nazwa</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Utworzono</TableCell>
                  <TableCell align="right">Akcje</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Chip label={u.role} size="small" color={u.role === "ADMIN" ? "error" : u.role === "MANAGER" ? "primary" : "default"} />
                    </TableCell>
                    <TableCell>{u.displayName || "—"}</TableCell>
                    <TableCell>{u.active ? "Aktywny" : "Nieaktywny"}</TableCell>
                    <TableCell>{u.createdAt ? new Date(u.createdAt).toLocaleDateString("pl-PL") : "—"}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => openEditModal(u)} title="Edytuj">
                        <Edit fontSize="small" />
                      </IconButton>
                      {u.active ? (
                        <IconButton size="small" onClick={() => handleDisable(u, false)} title="Wyłącz" disabled={u.id === currentUser.id}>
                          <Block fontSize="small" color="error" />
                        </IconButton>
                      ) : (
                        <IconButton size="small" onClick={() => handleDisable(u, true)} title="Włącz">
                          <CheckCircle fontSize="small" color="success" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === 1 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Aktywność</h2>
          <p style={{ color: tokens.color.textMuted, marginBottom: 16 }}>
            Ostatnie heartbeaty – użytkownik, urządzenie, wersja aplikacji. Online: ostatni &lt; 3 min.
          </p>
          {activity.length === 0 ? (
            <Typography color="text.secondary">Brak wpisów. Dane pojawią się po zalogowaniu użytkowników.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Użytkownik</TableCell>
                  <TableCell>Urządzenie</TableCell>
                  <TableCell>Wersja</TableCell>
                  <TableCell>Data</TableCell>
                  <TableCell>Online?</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activity.map((a) => {
                  const occurred = a.occurred_at ? new Date(a.occurred_at).getTime() : 0;
                  const now = Date.now();
                  const minsAgo = (now - occurred) / 60_000;
                  const isOnline = minsAgo < 3;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{a.user_display_name || a.user_email || a.user_id?.slice(0, 8) || "—"}</TableCell>
                      <TableCell>{a.device_type || "desktop"}</TableCell>
                      <TableCell>{a.app_version || "—"}</TableCell>
                      <TableCell>{a.occurred_at ? new Date(a.occurred_at).toLocaleString("pl-PL") : "—"}</TableCell>
                      <TableCell>
                        <Chip label={isOnline ? "Online" : "Offline"} size="small" color={isOnline ? "success" : "default"} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === 2 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Historia PDF</h2>
          <p style={{ color: tokens.color.textMuted, marginBottom: 16 }}>
            Wszystkie wygenerowane PDF wszystkich użytkowników.
          </p>
          {pdfs.length === 0 ? (
            <Typography color="text.secondary">Brak wygenerowanych PDF.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Klient</TableCell>
                  <TableCell>Handlowiec</TableCell>
                  <TableCell>Plik</TableCell>
                  <TableCell>Data</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pdfs.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.client_name || "—"}</TableCell>
                    <TableCell>{p.user_display_name || p.user_id?.slice(0, 8) || "—"}</TableCell>
                    <TableCell>{p.file_name || "—"}</TableCell>
                    <TableCell>{p.created_at ? new Date(p.created_at).toLocaleString("pl-PL") : "—"}</TableCell>
                    <TableCell>
                      <Chip label={p.status || "LOCAL"} size="small" color={p.status === "LOGGED" ? "success" : "default"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === 3 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Historia e-mail</h2>
          <p style={{ color: tokens.color.textMuted, marginBottom: 16 }}>
            Wszystkie wysłane e-maile wszystkich użytkowników.
          </p>
          {emails.length === 0 ? (
            <Typography color="text.secondary">Brak wysłanych e-maili.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Do</TableCell>
                  <TableCell>Handlowiec</TableCell>
                  <TableCell>Data</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Błąd</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {emails.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.to_email || "—"}</TableCell>
                    <TableCell>{e.user_display_name || e.user_id?.slice(0, 8) || "—"}</TableCell>
                    <TableCell>{e.created_at ? new Date(e.created_at).toLocaleString("pl-PL") : "—"}</TableCell>
                    <TableCell>
                      <Chip
                        label={e.status || "—"}
                        size="small"
                        color={e.status === "SENT" ? "success" : e.status === "FAILED" ? "error" : "default"}
                      />
                    </TableCell>
                    <TableCell>{e.error_message ? String(e.error_message).slice(0, 40) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <Dialog open={modalOpen} onClose={() => !submitting && setModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingUser ? "Edytuj użytkownika" : "Dodaj użytkownika"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Email"
            type="email"
            fullWidth
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
            required
          />
          <TextField
            margin="dense"
            label="Hasło"
            type="password"
            fullWidth
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            placeholder={editingUser ? "Zostaw puste, aby nie zmieniać" : ""}
            required={!editingUser}
          />
          <TextField
            margin="dense"
            label="Imię i nazwisko"
            fullWidth
            value={formDisplayName}
            onChange={(e) => setFormDisplayName(e.target.value)}
          />
          <FormControl fullWidth margin="dense">
            <InputLabel>Rola</InputLabel>
            <Select value={formRole} label="Rola" onChange={(e) => setFormRole(e.target.value)}>
              <MenuItem value="USER">USER (handlowiec)</MenuItem>
              <MenuItem value="SALESPERSON">SALESPERSON</MenuItem>
              <MenuItem value="BOSS">BOSS (manager)</MenuItem>
              <MenuItem value="MANAGER">MANAGER</MenuItem>
              <MenuItem value="ADMIN">ADMIN</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={submitting}>
            Anuluj
          </Button>
          <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
            {submitting ? "Zapisywanie…" : editingUser ? "Zapisz" : "Utwórz"}
          </Button>
        </DialogActions>
      </Dialog>

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
