"use strict";
/**
 * Szablon HTML „Oferta Planlux Hale” do generowania PDF.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderOfferHtml = renderOfferHtml;
const format_1 = require("../utils/format");
function renderOfferHtml(data) {
    const { offer, pricing, generatedAt, offerNumber } = data;
    const base = pricing.base;
    const hasBase = base.matched;
    const rows = [];
    if (hasBase) {
        rows.push(`
      <tr>
        <td>${(0, format_1.escapeHtml)(base.variantNazwa)}</td>
        <td>${(0, format_1.escapeHtml)(offer.areaM2 + " m²")}</td>
        <td>${(0, format_1.formatCurrency)(base.cenaPerM2)} zł/m²</td>
        <td>${(0, format_1.formatCurrency)(base.totalBase)} zł</td>
      </tr>`);
    }
    for (const a of pricing.additions) {
        rows.push(`
      <tr>
        <td>${(0, format_1.escapeHtml)(a.nazwa)} ${a.warunek ? `(${(0, format_1.escapeHtml)(a.warunek)})` : ""}</td>
        <td>${a.jednostka === "m2" ? (0, format_1.formatCurrency)(a.ilosc) + " m²" : a.jednostka === "mb" ? (0, format_1.formatCurrency)(a.ilosc) + " mb" : (0, format_1.formatCurrency)(a.ilosc) + " szt"}</td>
        <td>${(0, format_1.formatCurrency)(a.stawka)} ${a.jednostka === "m2" ? "zł/m²" : a.jednostka === "mb" ? "zł/mb" : "zł/szt"}</td>
        <td>${(0, format_1.formatCurrency)(a.total)} zł</td>
      </tr>`);
    }
    const standardRows = pricing.standardInPrice
        .map((s) => {
        const mode = s.pricingMode;
        const total = s.total;
        const suffix = mode === "CHARGE_EXTRA" && total != null ? ` – dolicz ${(0, format_1.formatCurrency)(total)} zł` : " – w cenie";
        return `
      <li>${(0, format_1.escapeHtml)(s.element)} – ${s.ilosc} ${s.jednostka} (wart. ref. ${(0, format_1.formatCurrency)(s.wartoscRef)} zł)${suffix}${s.uwagi ? " – " + (0, format_1.escapeHtml)(s.uwagi) : ""}</li>`;
    })
        .join("");
    return `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>Oferta Planlux Hale – ${(0, format_1.escapeHtml)(offer.clientName)}</title>
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
  ${offerNumber ? `<p><strong>Nr oferty:</strong> ${(0, format_1.escapeHtml)(offerNumber)}</p>` : ""}
  <p><strong>Data wygenerowania:</strong> ${(0, format_1.escapeHtml)(generatedAt)}</p>

  <h2>Klient</h2>
  <p>
    <strong>${(0, format_1.escapeHtml)(offer.clientName)}</strong><br>
    ${offer.clientEmail ? "E-mail: " + (0, format_1.escapeHtml)(offer.clientEmail) + "<br>" : ""}
    ${offer.clientPhone ? "Tel: " + (0, format_1.escapeHtml)(offer.clientPhone) : ""}
  </p>

  <h2>Parametry hali</h2>
  <p>
    Wymiary: ${offer.widthM} m × ${offer.lengthM} m ${offer.heightM != null ? "× " + offer.heightM + " m" : ""}<br>
    Powierzchnia: ${offer.areaM2} m²<br>
    Wariant: ${(0, format_1.escapeHtml)(offer.variantNazwa)}
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

  <p class="total">Razem: ${(0, format_1.formatCurrency)(pricing.totalPln)} zł netto</p>

  <p class="meta">Wygenerowano w aplikacji Planlux Hale. PLANLUX.</p>
</body>
</html>`;
}
