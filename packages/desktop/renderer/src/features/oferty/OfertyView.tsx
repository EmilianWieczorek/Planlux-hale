/**
 * Zakładka Oferty – CRM-lite: filtrowanie, wyszukiwanie, akcje, szczegóły.
 */

import { useState, useEffect } from "react";
import { Typography, TextField, Box, Tabs, Tab, Table, TableBody, TableCell, TableHead, TableRow, Button, Chip, Snackbar, Alert } from "@mui/material";
import { OfferDetailsView } from "./OfferDetailsView";

type OfferFilterTab = "in_progress" | "generated" | "sent" | "realized" | "all";

const TAB_LABELS: Record<OfferFilterTab, string> = {
  in_progress: "W trakcie",
  generated: "Wygenerowane",
  sent: "Wysłane",
  realized: "Zrealizowane",
  all: "Wszystkie",
};

interface Props {
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
  userId: string;
  isAdmin: boolean;
  online?: boolean;
  onEditOffer?: (offerId: string) => void;
}

export function OfertyView({ api, userId, isAdmin, online, onEditOffer }: Props) {
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OfferFilterTab>("in_progress");
  const [searchQuery, setSearchQuery] = useState("");
  const [syncingNumbers, setSyncingNumbers] = useState(false);
  const [offers, setOffers] = useState<Array<{
    id: string;
    offerNumber: string;
    status: string;
    userId?: string;
    clientFirstName: string;
    clientLastName: string;
    companyName: string;
    nip: string;
    phone: string;
    variantHali: string;
    widthM: number;
    lengthM: number;
    areaM2: number;
    totalPln: number;
    createdAt: string;
    pdfGeneratedAt: string | null;
    emailedAt: string | null;
    realizedAt: string | null;
  }>>([]);
  const [loading, setLoading] = useState(false);

  const [syncError, setSyncError] = useState<string | null>(null);
  const SYNC_TIMEOUT_MS = 4000;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setSyncError(null);
      try {
        const r = (await api("planlux:getOffersCrm", { statusFilter: activeTab, searchQuery })) as {
          ok: boolean;
          offers?: typeof offers;
        };
        if (cancelled) return;
        if (r.ok && r.offers) setOffers(r.offers);
        else setOffers([]);
      } catch (e) {
        if (!cancelled) {
          setOffers([]);
          setSyncError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    setSyncingNumbers(true);
    const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: "Limit czasu sync numerów (4s)" }), SYNC_TIMEOUT_MS)
    );
    Promise.race([api("planlux:syncTempOfferNumbers"), timeoutPromise])
      .then((syncRes) => {
        if (cancelled) return;
        const s = syncRes as { ok?: boolean; failed?: Array<{ error: string }>; error?: string };
        if (!s?.ok && (s?.failed?.length || s?.error)) {
          setSyncError(s.failed?.[0]?.error ?? s.error ?? "Nie udało się zsynchronizować numerów");
        }
      })
      .finally(() => {
        if (!cancelled) setSyncingNumbers(false);
      });

    return () => { cancelled = true; };
  }, [api, activeTab, searchQuery, isAdmin]);

  const handleMarkRealized = async (offerId: string) => {
    const r = (await api("planlux:markOfferRealized", offerId)) as { ok: boolean };
    if (r?.ok) {
      setOffers((prev) =>
        prev.map((o) =>
          o.id === offerId ? { ...o, status: "REALIZED", realizedAt: new Date().toISOString() } : o
        )
      );
    }
  };

  const getDateForStatus = (o: (typeof offers)[0]) => {
    if (o.status === "REALIZED" && o.realizedAt) return new Date(o.realizedAt).toLocaleDateString("pl-PL");
    if (o.status === "SENT" && o.emailedAt) return new Date(o.emailedAt).toLocaleDateString("pl-PL");
    if (o.status === "GENERATED" && o.pdfGeneratedAt) return new Date(o.pdfGeneratedAt).toLocaleDateString("pl-PL");
    return new Date(o.createdAt).toLocaleDateString("pl-PL");
  };

  const clientDisplay = (o: (typeof offers)[0]) =>
    o.companyName?.trim() || [o.clientFirstName, o.clientLastName].filter(Boolean).join(" ") || "—";

  const handleOpenPdf = async (filePath: string) => {
    await api("shell:openPath", filePath);
  };

  if (selectedOfferId) {
    return (
      <OfferDetailsView
        api={api}
        offerId={selectedOfferId}
        userId={userId}
        onBack={() => setSelectedOfferId(null)}
        onEdit={(id) => {
          setSelectedOfferId(null);
          onEditOffer?.(id);
        }}
        onOpenPdf={handleOpenPdf}
      />
    );
  }

  return (
    <Box>
      <Snackbar
        open={!!syncError}
        autoHideDuration={5000}
        onClose={() => setSyncError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" onClose={() => setSyncError(null)}>
          {syncError}
        </Alert>
      </Snackbar>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Oferty
      </Typography>
      <TextField
        size="small"
        placeholder="Szukaj: nr oferty, imię, firma, NIP, telefon..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        sx={{ mb: 2, minWidth: 280 }}
      />
      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 2 }}>
        {(Object.keys(TAB_LABELS) as OfferFilterTab[]).map((t) => (
          <Tab key={t} label={TAB_LABELS[t]} value={t} />
        ))}
      </Tabs>
      {loading ? (
        <Typography color="text.secondary">
          {syncingNumbers ? "Rezerwuję numery…" : "Ładowanie…"}
        </Typography>
      ) : offers.length === 0 ? (
        <Typography color="text.secondary">Brak ofert.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Klient</TableCell>
              <TableCell>Nr oferty</TableCell>
              <TableCell>Typ i wymiary</TableCell>
              <TableCell>Data</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Akcje</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {offers.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{clientDisplay(o)}</TableCell>
                <TableCell>
                  {o.offerNumber}
                  {o.offerNumber.startsWith("TEMP-") && syncingNumbers && (
                    <Chip label="Rezerwuję numer…" size="small" sx={{ ml: 1 }} color="warning" variant="outlined" />
                  )}
                </TableCell>
                <TableCell>
                  {o.variantHali} {o.widthM}×{o.lengthM} m ({o.areaM2} m²)
                </TableCell>
                <TableCell>{getDateForStatus(o)}</TableCell>
                <TableCell>{o.status}</TableCell>
                <TableCell>
                  {o.status !== "REALIZED" && (
                    <Button size="small" onClick={() => handleMarkRealized(o.id)}>
                      Zrealizowana
                    </Button>
                  )}
                  <Button size="small" sx={{ ml: 1 }} onClick={() => onEditOffer?.(o.id)}>
                    Edytuj
                  </Button>
                  <Button size="small" sx={{ ml: 1 }} onClick={() => setSelectedOfferId(o.id)}>
                    Otwórz
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}
