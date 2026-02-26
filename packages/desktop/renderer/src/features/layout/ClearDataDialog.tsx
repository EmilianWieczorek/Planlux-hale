import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";

export interface ClearDataDialogProps {
  open: boolean;
  mode: "global" | "editor";
  onClose: () => void;
  onConfirm: () => void;
}

export function ClearDataDialog({ open, mode, onClose, onConfirm }: ClearDataDialogProps) {
  const isGlobal = mode === "global";
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isGlobal ? "Wyczyść wszystkie dane" : "Wyczyść tylko edycję PDF"}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {isGlobal
            ? "Czy na pewno chcesz wyczyścić wszystkie dane? Zostaną usunięte: wymiary, klient, dodatki, nadpisania PDF."
            : "Czy na pewno chcesz wyczyścić nadpisania PDF (cena ręczna, treści strony 2)? Wymiary i dane klienta zostaną zachowane."}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Anuluj</Button>
        <Button onClick={onConfirm} color="warning" variant="contained">
          Wyczyść
        </Button>
      </DialogActions>
    </Dialog>
  );
}
