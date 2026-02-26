/**
 * Modal z listą potencjalnych duplikatów oferty – przy zapisie / generowaniu PDF.
 */

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import { Warning } from "@mui/icons-material";

export interface DuplicateOffer {
  id: string;
  offerNumber: string;
  status: string;
  clientDisplay: string;
  nip: string;
  phone: string;
  email: string;
  widthM: number;
  lengthM: number;
  areaM2: number;
  totalPln: number;
  createdAt: string;
}

interface Props {
  open: boolean;
  duplicates: DuplicateOffer[];
  onContinue: () => void;
  onOpenOffer: (offerId: string) => void;
  onCancel: () => void;
}

export function DuplicateOffersModal({
  open,
  duplicates,
  onContinue,
  onOpenOffer,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Warning color="warning" />
        Znaleziono podobne oferty
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Istnieją oferty dla tego klienta. Sprawdź, czy nie tworzysz duplikatu.
        </Typography>
        <List dense>
          {duplicates.map((d) => (
            <ListItem
              key={d.id}
              secondaryAction={
                <Button size="small" onClick={() => onOpenOffer(d.id)}>
                  Otwórz
                </Button>
              }
              sx={{ borderBottom: "1px solid", borderColor: "divider" }}
            >
              <ListItemText
                primary={d.clientDisplay || "—"}
                secondary={
                  <>
                    {d.offerNumber} · {d.widthM}×{d.lengthM} m · {d.totalPln.toLocaleString("pl-PL")} zł · {d.status}
                    <br />
                    {d.createdAt && new Date(d.createdAt).toLocaleDateString("pl-PL")}
                  </>
                }
              />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Anuluj</Button>
        <Button variant="contained" onClick={onContinue} color="primary">
          Kontynuuj mimo to
        </Button>
      </DialogActions>
    </Dialog>
  );
}
