/**
 * Szablon HTML „Oferta Planlux Hale” do generowania PDF.
 */

import type { PricingResult } from "../pricing/types";
import { escapeHtml, formatCurrency } from "../utils/format";

export interface OfferForPdf {
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  widthM: number;
  lengthM: number;
  heightM?: number;
  areaM2: number;
  variantNazwa: string;
  variantHali: string;
}

export interface PdfTemplateData {
  offer: OfferForPdf;
  pricing: PricingResult;
  generatedAt: string;
  offerNumber?: string;
}

export function renderOfferHtml(data: PdfTemplateData): string {
  const { offer, pricing, generatedAt, offerNumber } = data;
  const base = pricing.base;
  const hasBase = base.matched;

  const rows: string[] = [];

  if (hasBase) {
    rows.push(`
      <tr>
        <td>${escapeHtml(base.variantNazwa)}</td>
        <td>${escapeHtml(offer.areaM2 + " m²")}</td>
        <td>${formatCurrency(base.cenaPerM2)} zł/m²</td>
        <td>${formatCurrency(base.totalBase)} zł</td>
      </tr>`);
  }

  for (const a of pricing.additions) {
    rows.push(`
      <tr>
        <td>${escapeHtml(a.nazwa)} ${a.warunek ? `(${escapeHtml(a.warunek)})` : ""}</td>
        <td>${a.jednostka === "m2" ? formatCurrency(a.ilosc) + " m²" : a.jednostka === "mb" ? formatCurrency(a.ilosc) + " mb" : formatCurrency(a.ilosc) + " szt"}</td>
        <td>${formatCurrency(a.stawka)} ${a.jednostka === "m2" ? "zł/m²" : a.jednostka === "mb" ? "zł/mb" : "zł/szt"}</td>
        <td>${formatCurrency(a.total)} zł</td>
      </tr>`);
  }

  const standardRows = pricing.standardInPrice
    .map((s) => {
      const mode = (s as { pricingMode?: string }).pricingMode;
      const total = (s as { total?: number }).total;
      const suffix =
        mode === "CHARGE_EXTRA" && total != null ? ` – dolicz ${formatCurrency(total)} zł` : " – w cenie";
      return `
      <li>${escapeHtml(s.element)} – ${s.ilosc} ${s.jednostka} (wart. ref. ${formatCurrency(s.wartoscRef)} zł)${suffix}${s.uwagi ? " – " + escapeHtml(s.uwagi) : ""}</li>`;
    })
    .join("");

  return `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>Oferta Planlux Hale – ${escapeHtml(offer.clientName)}</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; margin: 24px; line-height: 1.4; }
    h1 { font-size: 18pt; margin-bottom: 8px; }
    h2 { font-size: 13pt; margin-top: 20px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .right { text-align: right; }
    .total { font-weight: bold; font-size: 12pt; }
    ul { margin: 8px 0; padding-left: 20px; }
    .meta { color: #666; font-size: 9pt; margin-top: 24px; }
  </style>
</head>
<body>
  <h1>Oferta Planlux Hale</h1>
  ${offerNumber ? `<p><strong>Nr oferty:</strong> ${escapeHtml(offerNumber)}</p>` : ""}
  <p><strong>Data wygenerowania:</strong> ${escapeHtml(generatedAt)}</p>

  <h2>Klient</h2>
  <p>
    <strong>${escapeHtml(offer.clientName)}</strong><br>
    ${offer.clientEmail ? "E-mail: " + escapeHtml(offer.clientEmail) + "<br>" : ""}
    ${offer.clientPhone ? "Tel: " + escapeHtml(offer.clientPhone) : ""}
  </p>

  <h2>Parametry hali</h2>
  <p>
    Wymiary: ${offer.widthM} m × ${offer.lengthM} m ${offer.heightM != null ? "× " + offer.heightM + " m" : ""}<br>
    Powierzchnia: ${offer.areaM2} m²<br>
    Wariant: ${escapeHtml(offer.variantNazwa)}
  </p>

  <h2>Rozpiska cenowa</h2>
  <table>
    <thead>
      <tr>
        <th>Pozycja</th>
        <th>Ilość / Jednostka</th>
        <th>Stawka</th>
        <th class="right">Wartość</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join("")}
    </tbody>
  </table>

  ${standardRows ? `<h2>Standard w cenie</h2><ul>${standardRows}</ul>` : ""}

  <p class="total">Razem: ${formatCurrency(pricing.totalPln)} zł netto</p>

  <p class="meta">Wygenerowano w aplikacji Planlux Hale. PLANLUX.</p>
</body>
</html>`;
}
