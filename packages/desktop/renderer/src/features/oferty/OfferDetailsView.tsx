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
} from "@mui/material";
import { ArrowBack, Email } from "@mui/icons-material";
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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [offerRes, auditRes, emailRes, pdfRes] = await Promise.all([
          api("planlux:getOfferDetails", offerId, userId) as Promise<{ ok: boolean; offer?: Offer }>,
          api("planlux:getOfferAudit", offerId, userId) as Promise<{ ok: boolean; items?: AuditItem[] }>,
          api("planlux:getEmailHistoryForOffer", offerId, userId) as Promise<{ ok: boolean; emails?: EmailItem[] }>,
          api("planlux:getPdfsForOffer", offerId, userId) as Promise<{ ok: boolean; pdfs?: PdfItem[] }>,
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
  }, [api, offerId, userId]);

  const refreshData = async () => {
    try {
      const [offerRes, auditRes, emailRes, pdfRes] = await Promise.all([
        api("planlux:getOfferDetails", offerId, userId) as Promise<{ ok: boolean; offer?: Offer }>,
        api("planlux:getOfferAudit", offerId, userId) as Promise<{ ok: boolean; items?: AuditItem[] }>,
        api("planlux:getEmailHistoryForOffer", offerId, userId) as Promise<{ ok: boolean; emails?: EmailItem[] }>,
        api("planlux:getPdfsForOffer", offerId, userId) as Promise<{ ok: boolean; pdfs?: PdfItem[] }>,
      ]);
      if (offerRes.ok && offerRes.offer) setOffer(offerRes.offer);
      if (auditRes.ok && auditRes.items) setAuditItems(auditRes.items);
      if (emailRes.ok && emailRes.emails) setEmails(emailRes.emails);
      if (pdfRes.ok && pdfRes.pdfs) setPdfs(pdfRes.pdfs);
    } catch {
      /* ignore */
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
            startIcon={<Email />}
            onClick={() => setEmailComposerOpen(true)}
            sx={{ mr: 1 }}
          >
            Wyślij e-mail
          </Button>
        </>
      )}

      <EmailComposer
        open={emailComposerOpen}
        onClose={() => setEmailComposerOpen(false)}
        defaultTo={offer.email || ""}
        defaultSubject={`Oferta PLANLUX ${offer.offerNumber} – ${offer.variantHali} ${offer.widthM}×${offer.lengthM} m`}
        defaultBody={`Szanowni Państwo,\n\nW załączeniu przesyłam ofertę na halę stalową.\n\nPozdrawiam`}
        pdfPath={pdfs[0]?.filePath ?? null}
        pdfFileName={pdfs[0]?.fileName}
        onSend={async (p) => {
          const r = (await api("planlux:sendOfferEmail", offerId, userId, {
            to: p.to,
            subject: p.subject,
            body: p.body,
            pdfPath: p.pdfPath,
          })) as { ok: boolean; error?: string };
          if (r.ok) await refreshData();
          return r;
        }}
      />
    </Box>
  );
}
