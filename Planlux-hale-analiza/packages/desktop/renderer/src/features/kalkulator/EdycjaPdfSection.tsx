import { useState, useCallback } from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tabs,
  Tab,
  TextField,
  FormControlLabel,
  Checkbox,
  Button,
  Typography,
  Box,
} from "@mui/material";
import type { PdfOverrides } from "../../state/pdfOverrides";
import { mergePdfOverrides, DEFAULT_PDF_OVERRIDES_PAGE2 } from "../../state/pdfOverrides";

const BOX_LABELS: Record<string, string> = {
  boxText1: "Box 1 (Dokumentacja)",
  boxText2: "Box 2 (Konstrukcja)",
  boxText3: "Box 3 (Pokrycie dachu)",
  boxText4: "Box 4 (Ściany + stolarka)",
};

export interface EdycjaPdfSectionProps {
  pdfOverrides: PdfOverrides;
  onPdfOverridesChange: (next: PdfOverrides) => void;
  calculatorPriceNet?: number;
  calculatorPriceGross?: number;
  onDirtyChange?: (mode?: "typing" | "commit") => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  activeTab?: 0 | 1 | 2;
  onActiveTabChange?: (tab: 0 | 1 | 2) => void;
}

export function EdycjaPdfSection({
  pdfOverrides,
  onPdfOverridesChange,
  calculatorPriceNet,
  calculatorPriceGross,
  onDirtyChange,
  expanded = false,
  onExpandedChange,
  activeTab = 0,
  onActiveTabChange,
}: EdycjaPdfSectionProps) {
  const [tab, setTab] = useState<0 | 1 | 2>(activeTab);
  const currentTab = onActiveTabChange ? activeTab : tab;
  const setCurrentTab = useCallback(
    (t: 0 | 1 | 2) => {
      if (onActiveTabChange) onActiveTabChange(t);
      else setTab(t);
    },
    [onActiveTabChange]
  );

  const markDirty = useCallback((mode: "typing" | "commit" = "typing") => onDirtyChange?.(mode), [onDirtyChange]);

  const updatePage1 = useCallback(
    (partial: Partial<NonNullable<PdfOverrides["page1"]>>, mode: "typing" | "commit" = "typing") => {
      const next = mergePdfOverrides({
        ...pdfOverrides,
        page1: { ...pdfOverrides.page1, ...partial },
      });
      onPdfOverridesChange(next);
      markDirty(mode);
    },
    [pdfOverrides, onPdfOverridesChange, markDirty]
  );

  const updatePage2 = useCallback(
    (partial: Partial<NonNullable<PdfOverrides["page2"]>>, mode: "typing" | "commit" = "typing") => {
      const next = mergePdfOverrides({
        ...pdfOverrides,
        page2: { ...DEFAULT_PDF_OVERRIDES_PAGE2, ...pdfOverrides.page2, ...partial },
      });
      onPdfOverridesChange(next);
      markDirty(mode);
    },
    [pdfOverrides, onPdfOverridesChange, markDirty]
  );

  const useManualPrice = Boolean(
    pdfOverrides.page1?.priceNet != null || pdfOverrides.page1?.priceGross != null
  );

  const handleUseManualPriceChange = (checked: boolean) => {
    if (checked) {
      updatePage1({
        priceNet: calculatorPriceNet,
        priceGross: calculatorPriceGross ?? calculatorPriceNet,
      }, "commit");
    } else {
      updatePage1({ priceNet: undefined, priceGross: undefined }, "commit");
    }
  };

  const resetPrice = () => {
    updatePage1({ priceNet: undefined, priceGross: undefined }, "commit");
  };

  const parsePln = (s: string) => {
    const n = parseFloat(s.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const summaryPreview = (() => {
    if (useManualPrice) return "Cena ręczna";
    if (pdfOverrides.page2?.boxText1 || pdfOverrides.page2?.boxText2) return "Treści edytowane";
    return "Brak zmian";
  })();

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, exp) => onExpandedChange?.(exp)}
      sx={{ "&:before": { display: "none" } }}
    >
      <AccordionSummary expandIcon={<span style={{ fontSize: 16 }}>▼</span>}>
        <Typography variant="subtitle2">Edycja PDF</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {summaryPreview}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Tabs
          value={currentTab}
          onChange={(_, v) => setCurrentTab(v as 0 | 1 | 2)}
          sx={{ minHeight: 36, mb: 2 }}
        >
          <Tab label="Strona 1" sx={{ minHeight: 36, py: 0 }} />
          <Tab label="Strona 2" sx={{ minHeight: 36, py: 0 }} />
          <Tab label="Strona 3 (zablokowana)" disabled sx={{ minHeight: 36, py: 0 }} />
        </Tabs>

        {currentTab === 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={useManualPrice}
                  onChange={(e) => handleUseManualPriceChange(e.target.checked)}
                />
              }
              label="Użyj ręcznej ceny w PDF"
            />
            {useManualPrice && (
              <>
                <TextField
                  label="Cena netto (opcjonalnie)"
                  type="number"
                  size="small"
                  value={pdfOverrides.page1?.priceNet ?? ""}
                  onChange={(e) => {
                    const v = parsePln(e.target.value);
                    updatePage1({ priceNet: v }, "typing");
                  }}
                  onBlur={(e) => updatePage1({ priceNet: parsePln(e.target.value) }, "commit")}
                  inputProps={{ min: 0, step: 0.01 }}
                />
                <TextField
                  label="Cena brutto"
                  type="number"
                  size="small"
                  required
                  value={pdfOverrides.page1?.priceGross ?? ""}
                  onChange={(e) => {
                    const v = parsePln(e.target.value);
                    updatePage1({ priceGross: v }, "typing");
                  }}
                  onBlur={(e) => updatePage1({ priceGross: parsePln(e.target.value) }, "commit")}
                  inputProps={{ min: 0, step: 0.01 }}
                />
                <Button size="small" variant="outlined" onClick={resetPrice}>
                  Reset ceny PDF
                </Button>
              </>
            )}
          </Box>
        )}

        {currentTab === 1 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Tytuł: SPECYFIKACJA TECHNICZNA (nie edytowalny)
            </Typography>
            {(["boxText1", "boxText2", "boxText3", "boxText4"] as const).map((key) => (
              <TextField
                key={key}
                label={BOX_LABELS[key]}
                multiline
                minRows={3}
                size="small"
                value={pdfOverrides.page2?.[key] ?? DEFAULT_PDF_OVERRIDES_PAGE2[key]}
                onChange={(e) => updatePage2({ [key]: e.target.value }, "typing")}
                onBlur={() => onDirtyChange?.("commit")}
              />
            ))}
            <TextField
              label="Notatka handlowca"
              multiline
              minRows={2}
              size="small"
              value={pdfOverrides.page2?.note ?? ""}
              onChange={(e) => updatePage2({ note: e.target.value }, "typing")}
              onBlur={() => onDirtyChange?.("commit")}
            />
          </Box>
        )}

        {currentTab === 2 && (
          <Typography variant="body2" color="text.secondary">
            Strona 3 jest stała i nie podlega edycji.
          </Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
