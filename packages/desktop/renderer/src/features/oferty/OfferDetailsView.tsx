/**
 * Widok szczegółów oferty – dane klienta, parametry, dodatki, cena, audit trail, e-maile, pliki PDF.
 */

import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Stack,
  Snackbar,
} from "@mui/material";
import { ArrowBack, Email, Delete as DeleteIcon, PictureAsPdf } from "@mui/icons-material";
import { EmailComposer } from "./EmailComposer";

interface Offer {
  id: string;
  offerNumber: string;
  status: string;
  clientFirstName: string;
  clientLastName: string;
  companyName: string;
  nip: string;
  phone: string;
  email: string;
  variantHali: string;
  widthM: number;
  lengthM: number;
  heightM: number | null;
  areaM2: number;
  hallSummary: string;
  basePricePln: number;
  additionsTotalPln: number;
  totalPln: number;
  standardSnapshot: string;
  addonsSnapshot: string;
  noteHtml: string;
  version: number;
  createdAt: string;
  pdfGeneratedAt: string | null;
  emailedAt: string | null;
  realizedAt: string | null;
}

interface AuditItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface EmailItem {
  id: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

interface PdfItem {
  id: string;
  fileName: string;
  filePath: string;
  status: string;
  createdAt: string;
}

const AUDIT_LABELS: Record<string, string> = {
  CREATE_DRAFT: "Utworzono szkic",
  UPDATE_DRAFT: "Zaktualizowano",
  PDF_GENERATED: "Wygenerowano PDF",
  EMAIL_QUEUED: "E-mail w kolejce",
  EMAIL_SENT: "Wysłano e-mail",
  STATUS_CHANGED: "Zmiana statusu",
  OFFER_CREATED: "Utworzono ofertę",
  OFFER_REALIZED: "Zrealizowano",
  REALIZED: "Zrealizowano",
};

interface Props {
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
  offerId: string;
  userId: string;
  onBack: () => void;
  onEdit: (offerId: string) => void;
  onOpenPdf: (filePath: string) => void;
}

export function OfferDetailsView({ api, offerId, userId, onBack, onEdit, onOpenPdf }: Props) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [pdfs, setPdfs] = useState<PdfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [queueSnackbarOpen, setQueueSnackbarOpen] = useState(false);
  const [lastGeneratedPdf, setLastGeneratedPdf] = useState<{ filePath: string; fileName: string } | null>(null);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [emailPreview, setEmailPreview] = useState<{
    subject: string;
    body: string;
    officeCcDefault: boolean;
    officeCcEmail: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [offerRes, auditRes, emailRes, pdfRes] = await Promise.all([
          api("planlux:getOfferDetails", offerId) as Promise<{ ok: boolean; offer?: Offer }>,
          api("planlux:getOfferAudit", offerId) as Promise<{ ok: boolean; items?: AuditItem[] }>,
          api("planlux:getEmailHistoryForOffer", offerId) as Promise<{ ok: boolean; emails?: EmailItem[] }>,
          api("planlux:getPdfsForOffer", offerId) as Promise<{ ok: boolean; pdfs?: PdfItem[] }>,
        ]);
        if (cancelled) return;
        if (offerRes.ok && offerRes.offer) setOffer(offerRes.offer);
        if (auditRes.ok && auditRes.items) setAuditItems(auditRes.items);
        if (emailRes.ok && emailRes.emails) setEmails(emailRes.emails);
        if (pdfRes.ok && pdfRes.pdfs) setPdfs(pdfRes.pdfs);
      } catch {
        if (!cancelled) setOffer(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [api, offerId]);

  const refreshData = async () => {
    try {
      const [offerRes, auditRes, emailRes, pdfRes] = await Promise.all([
        api("planlux:getOfferDetails", offerId) as Promise<{ ok: boolean; offer?: Offer }>,
        api("planlux:getOfferAudit", offerId) as Promise<{ ok: boolean; items?: AuditItem[] }>,
        api("planlux:getEmailHistoryForOffer", offerId) as Promise<{ ok: boolean; emails?: EmailItem[] }>,
        api("planlux:getPdfsForOffer", offerId) as Promise<{ ok: boolean; pdfs?: PdfItem[] }>,
      ]);
      if (offerRes.ok && offerRes.offer) setOffer(offerRes.offer);
      if (auditRes.ok && auditRes.items) setAuditItems(auditRes.items);
      if (emailRes.ok && emailRes.emails) setEmails(emailRes.emails);
      if (pdfRes.ok && pdfRes.pdfs) setPdfs(pdfRes.pdfs);
    } catch {
      /* ignore */
    }
  };

  const effectivePdf = lastGeneratedPdf ?? pdfs[0] ?? null;
  const handleGeneratePdf = async () => {
    setGeneratingPdf(true);
    try {
      const res = (await api("planlux:pdf:ensureOfferPdf", offerId)) as { ok: boolean; filePath?: string; fileName?: string; error?: string };
      if (res.ok && res.filePath && res.fileName) {
        setLastGeneratedPdf({ filePath: res.filePath, fileName: res.fileName });
        await refreshData();
        setSnackbarMessage(`PDF wygenerowany: ${res.fileName}`);
      } else {
        setSnackbarMessage(res.error ?? "Nie udało się wygenerować PDF");
      }
    } catch (e) {
      setSnackbarMessage(e instanceof Error ? e.message : "Błąd generowania PDF");
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDeleteOffer = async () => {
    if (offer?.status !== "IN_PROGRESS") return;
    if (!window.confirm("Czy na pewno chcesz usunąć tę ofertę? Tej operacji nie można cofnąć.")) return;
    setDeleting(true);
    try {
      const res = (await api("planlux:deleteOffer", offerId)) as { ok: boolean; error?: string; code?: string };
      if (res.ok) {
        setSnackbarMessage("Oferta usunięta");
        onBack();
      } else {
        setSnackbarMessage(res.error ?? "Nie udało się usunąć oferty");
      }
    } catch (e) {
      setSnackbarMessage(e instanceof Error ? e.message : "Błąd usuwania");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <Typography color="text.secondary">Ładowanie...</Typography>;
  if (!offer) return <Typography color="error">Nie znaleziono oferty.</Typography>;

  const clientDisplay = offer.companyName?.trim() || [offer.clientFirstName, offer.clientLastName].filter(Boolean).join(" ") || "—";
  const addons = (() => {
    try {
      return JSON.parse(offer.addonsSnapshot || "[]") as Array<{ nazwa?: string; name?: string; ilosc?: number; quantity?: number; total?: number }>;
    } catch {
      return [];
    }
  })();
  const standards = (() => {
    try {
      return JSON.parse(offer.standardSnapshot || "[]") as Array<{ element?: string; ilosc?: number; wartoscRef?: number; pricingMode?: string; total?: number }>;
    } catch {
      return [];
    }
  })();

  return (
    <Box>
      <Button startIcon={<ArrowBack />} onClick={onBack} sx={{ mb: 2 }}>
        Wróć do listy
      </Button>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Oferta {offer.offerNumber}
      </Typography>
      <Chip label={offer.status} size="small" sx={{ mb: 2 }} color={offer.status === "REALIZED" ? "success" : "default"} />

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>Dane klienta</Typography>
        <Typography>Klient: {clientDisplay}</Typography>
        {offer.nip && <Typography variant="body2">NIP: {offer.nip}</Typography>}
        {offer.phone && <Typography variant="body2">Tel: {offer.phone}</Typography>}
        {offer.email && <Typography variant="body2">E-mail: {offer.email}</Typography>}
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>Parametry hali</Typography>
        <Typography>
          {offer.variantHali} – {offer.widthM}×{offer.lengthM} m
          {offer.heightM != null ? ` × ${offer.heightM} m` : ""} ({offer.areaM2} m²)
        </Typography>
      </Paper>

      {(addons.length > 0 || standards.length > 0) && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>Dodatki i standardy</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Pozycja</TableCell>
                <TableCell align="right">Ilość</TableCell>
                <TableCell align="right">Wartość</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {standards.map((s, i) => (
                <TableRow key={`std-${i}`}>
                  <TableCell>{s.element ?? "—"}</TableCell>
                  <TableCell align="right">{s.ilosc ?? 1}</TableCell>
                  <TableCell align="right">
                    {s.pricingMode === "CHARGE_EXTRA" && s.total != null ? `${s.total.toLocaleString("pl-PL")} zł` : "w cenie"}
                  </TableCell>
                </TableRow>
              ))}
              {addons.map((a, i) => (
                <TableRow key={`add-${i}`}>
                  <TableCell>{a.nazwa ?? a.name ?? "—"}</TableCell>
                  <TableCell align="right">{a.ilosc ?? a.quantity ?? 1}</TableCell>
                  <TableCell align="right">{a.total != null ? `${a.total} zł` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>Podsumowanie ceny</Typography>
        <Typography>Cena bazowa: {offer.basePricePln.toLocaleString("pl-PL")} zł</Typography>
        <Typography>Dodatki: {offer.additionsTotalPln.toLocaleString("pl-PL")} zł</Typography>
        <Typography variant="h6" color="primary">Razem: {offer.totalPln.toLocaleString("pl-PL")} zł</Typography>
      </Paper>

      {auditItems.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>Historia zdarzeń</Typography>
          <Stack spacing={1}>
            {auditItems.map((item) => (
              <Box key={item.id} sx={{ display: "flex", flexDirection: "column", gap: 0.5, py: 0.5, borderLeft: "3px solid", borderColor: "primary.main", pl: 1.5 }}>
                <Typography variant="body2" fontWeight="medium">
                  {AUDIT_LABELS[item.type] ?? item.type}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(item.createdAt).toLocaleString("pl-PL")}
                </Typography>
                {item.payload?.fileName && (
                  <Typography variant="caption" display="block">{String(item.payload.fileName)}</Typography>
                )}
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      {emails.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>E-maile</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Do</TableCell>
                <TableCell>Temat</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Data</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {emails.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.toEmail}</TableCell>
                  <TableCell>{e.subject}</TableCell>
                  <TableCell><Chip label={e.status} size="small" /></TableCell>
                  <TableCell>{e.sentAt ? new Date(e.sentAt).toLocaleString("pl-PL") : new Date(e.createdAt).toLocaleString("pl-PL")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {pdfs.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>Pliki PDF</Typography>
          {pdfs.map((p) => (
            <Box key={p.id} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Typography variant="body2">{p.fileName}</Typography>
              <Button size="small" onClick={() => onOpenPdf(p.filePath)}>
                Otwórz
              </Button>
            </Box>
          ))}
        </Paper>
      )}

      {offer.status !== "REALIZED" && (
        <>
          <Button variant="contained" onClick={() => onEdit(offerId)} sx={{ mr: 1 }}>
            Edytuj
          </Button>
          <Button
            variant="outlined"
            startIcon={<PictureAsPdf />}
            onClick={handleGeneratePdf}
            disabled={generatingPdf}
            sx={{ mr: 1 }}
          >
            {generatingPdf ? "Generowanie…" : "Generuj PDF"}
          </Button>
          <Button
            variant="outlined"
            startIcon={<Email />}
            onClick={async () => {
              setEmailComposerOpen(true);
              const prev = (await api("planlux:email:getOfferEmailPreview", offerId)) as {
                ok: boolean;
                subject?: string;
                bodyHtml?: string;
                bodyText?: string;
                officeCcDefault?: boolean;
                officeCcEmail?: string;
              };
              if (prev.ok) {
                setEmailPreview({
                  subject: prev.subject ?? `Oferta Planlux – ${offer.offerNumber}`,
                  body: (prev.bodyText ?? prev.bodyHtml ?? "").replace(/<[^>]+>/g, "\n"),
                  officeCcDefault: prev.officeCcDefault ?? true,
                  officeCcEmail: prev.officeCcEmail ?? "biuro@planlux.pl",
                });
              } else {
                setEmailPreview({
                  subject: `Oferta Planlux – ${offer.offerNumber}`,
                  body: `Szanowni Państwo,\n\nW załączeniu przesyłam ofertę ${offer.offerNumber}.\n\nPozdrawiam`,
                  officeCcDefault: true,
                  officeCcEmail: "biuro@planlux.pl",
                });
              }
            }}
            sx={{ mr: 1 }}
          >
            Wyślij e-mail
          </Button>
          {offer.status === "IN_PROGRESS" && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteOffer}
              disabled={deleting}
              sx={{ mr: 1 }}
            >
              {deleting ? "Usuwanie…" : "Usuń ofertę"}
            </Button>
          )}
        </>
      )}

      <EmailComposer
        open={emailComposerOpen}
        onClose={() => setEmailComposerOpen(false)}
        defaultTo={offer.email || ""}
        defaultSubject={emailPreview?.subject ?? `Oferta Planlux – ${offer.offerNumber}`}
        defaultBody={emailPreview?.body ?? `Szanowni Państwo,\n\nW załączeniu przesyłam ofertę ${offer.offerNumber}.\n\nPozdrawiam`}
        officeCcDefault={emailPreview?.officeCcDefault ?? true}
        officeCcEmail={emailPreview?.officeCcEmail ?? "biuro@planlux.pl"}
        pdfPath={effectivePdf?.filePath ?? null}
        pdfFileName={effectivePdf?.fileName}
        onSend={async (p) => {
          const res = (await api("planlux:email:sendOfferEmail", {
            offerId,
            to: p.to,
            ccOfficeEnabled: p.ccOfficeEnabled,
            subjectOverride: p.subject || undefined,
            bodyOverride: p.body ? p.body.replace(/\n/g, "<br>") : undefined,
          })) as {
            ok: boolean;
            sent?: boolean;
            queued?: boolean;
            error?: string;
            code?: string;
            message?: string;
            sheetsError?: { code?: string; message: string; details?: { status?: number; contentType?: string; bodySnippet?: string } };
          };
          if (res.queued) setQueueSnackbarOpen(true);
          if (res.ok) await refreshData();
          const messageByCode: Record<string, string> = {
            ERR_NO_TO: "Podaj adres e-mail odbiorcy.",
            ERR_NO_USER: "Brak użytkownika (user_id) – nie można zapisać historii e-mail.",
            ERR_NO_ATTACHMENT: "Brak załącznika PDF. Wygeneruj PDF oferty przed wysłaniem.",
            ERR_AUTH: "Błąd autoryzacji SMTP. Sprawdź ustawienia konta e-mail w Panelu admina.",
            ERR_TIMEOUT: "Przekroczono limit czasu połączenia. Sprawdź internet i spróbuj ponownie.",
            ERR_HISTORY_WRITE: "E-mail został wysłany, ale nie zapisano go w historii. Sprawdź logi i bazę – nie wysyłaj ponownie.",
            ERR_SHEETS_BAD_JSON: "Backend zwrócił nieprawidłową odpowiedź (nie JSON). Zapis w kolejce – sprawdź logi (status, content-type, fragment odpowiedzi).",
          };
          let friendlyError: string | undefined;
          if (res.ok && res.sent && res.sheetsError) {
            friendlyError = `E-mail wysłany. Zapis do backendu nie powiódł się: ${res.sheetsError.message} Wpis w kolejce – spróbuję ponownie.`;
          } else if (!res.ok) {
            const baseMsg = (res as { message?: string }).message ?? (res.code && messageByCode[res.code] ? messageByCode[res.code] : res.error);
            const details = (res as { details?: unknown }).details;
            friendlyError = typeof details === "string" ? `${baseMsg} (${details.slice(0, 120)})` : baseMsg;
          }
          return { ...res, error: friendlyError };
        }}
      />
      <Snackbar
        open={queueSnackbarOpen}
        autoHideDuration={6000}
        onClose={() => setQueueSnackbarOpen(false)}
        message="Brak prawdziwego połączenia z internetem — e-maile trafią do kolejki."
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
      <Snackbar
        open={!!snackbarMessage}
        autoHideDuration={4000}
        onClose={() => setSnackbarMessage(null)}
        message={snackbarMessage ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
