/**
 * Kompozytor e-mail – Do, Temat, Treść, Załączniki (PDF + opcjonalne).
 */

import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
} from "@mui/material";
import { Send } from "@mui/icons-material";

interface Props {
  open: boolean;
  onClose: () => void;
  defaultTo: string;
  defaultSubject: string;
  defaultBody?: string;
  pdfPath?: string | null;
  pdfFileName?: string;
  onSend: (params: { to: string; subject: string; body: string; pdfPath?: string }) => Promise<{ ok: boolean; error?: string }>;
}

export function EmailComposer({
  open,
  onClose,
  defaultTo,
  defaultSubject,
  defaultBody = "",
  pdfPath,
  pdfFileName,
  onSend,
}: Props) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!to.trim()) {
      setError("Podaj adres e-mail odbiorcy.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await onSend({
        to: to.trim(),
        subject: subject.trim() || defaultSubject,
        body: body.trim(),
        pdfPath: pdfPath ?? undefined,
      });
      if (res.ok) {
        onClose();
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
          {pdfPath && pdfFileName && (
            <Typography variant="body2" color="text.secondary">
              Załącznik: {pdfFileName}
            </Typography>
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
