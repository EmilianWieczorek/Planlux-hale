/**
 * Kompozytor e-mail – Do, Temat, Treść, CC do biura, Załączniki (PDF z oferty).
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  FormControlLabel,
  Checkbox,
  Alert,
} from "@mui/material";
import { Send } from "@mui/icons-material";

export type SendResult = { ok: boolean; error?: string; queued?: boolean };

interface Props {
  open: boolean;
  onClose: () => void;
  defaultTo: string;
  defaultSubject: string;
  defaultBody?: string;
  /** Domyślnie włączone „Wyślij kopię do biura” (z ustawień). */
  officeCcDefault?: boolean;
  /** Adres biura do CC (np. biuro@planlux.pl) – wyświetlany przy checkboxie. */
  officeCcEmail?: string;
  pdfPath?: string | null;
  pdfFileName?: string;
  onSend: (params: { to: string; subject: string; body: string; ccOfficeEnabled: boolean; pdfPath?: string }) => Promise<SendResult>;
}

export function EmailComposer({
  open,
  onClose,
  defaultTo,
  defaultSubject,
  defaultBody = "",
  officeCcDefault = true,
  officeCcEmail,
  pdfPath,
  pdfFileName,
  onSend,
}: Props) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [ccOfficeEnabled, setCcOfficeEnabled] = useState(officeCcDefault);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<"sent" | "queued" | null>(null);

  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setSubject(defaultSubject);
      setBody(defaultBody);
      setCcOfficeEnabled(officeCcDefault);
      setError(null);
      setResultMessage(null);
    }
  }, [open, defaultTo, defaultSubject, defaultBody, officeCcDefault]);

  const handleSend = async () => {
    if (!to.trim()) {
      setError("Podaj adres e-mail odbiorcy.");
      return;
    }
    setSending(true);
    setError(null);
    setResultMessage(null);
    try {
      const res = await onSend({
        to: to.trim(),
        subject: subject.trim() || defaultSubject,
        body: body.trim(),
        ccOfficeEnabled,
        pdfPath: pdfPath ?? undefined,
      });
      if (res.ok) {
        if (res.queued) {
          setResultMessage("queued");
        } else {
          setResultMessage("sent");
          setTimeout(() => onClose(), 1500);
        }
      } else {
        setError(res.error ?? "Błąd wysyłki");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd wysyłki");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Wyślij ofertę e-mailem</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            label="Do"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            fullWidth
            required
            placeholder="klient@firma.pl"
          />
          <TextField
            label="Temat"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            fullWidth
            placeholder="Oferta PLANLUX - typ i wymiary"
          />
          <TextField
            label="Treść"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            fullWidth
            multiline
            rows={6}
            placeholder="Szanowni Państwo,&#10;&#10;W załączeniu przesyłam ofertę..."
          />
          {officeCcEmail && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={ccOfficeEnabled}
                  onChange={(e) => setCcOfficeEnabled(e.target.checked)}
                  color="primary"
                />
              }
              label={`CC do biura (${officeCcEmail})`}
            />
          )}
          {pdfPath && pdfFileName && (
            <Typography variant="body2" color="text.secondary">
              Załącznik: {pdfFileName}
            </Typography>
          )}
          {resultMessage === "sent" && (
            <Alert severity="success">E-mail wysłany.</Alert>
          )}
          {resultMessage === "queued" && (
            <Alert severity="info">Dodano do kolejki – zostanie wysłany po powrocie połączenia.</Alert>
          )}
          {error && (
            <Typography color="error" variant="body2">
              {error}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Anuluj</Button>
        <Button variant="contained" onClick={handleSend} disabled={sending} startIcon={<Send />}>
          {sending ? "Wysyłanie…" : "Wyślij"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
