/**
 * Planlux-PDF template renderer: read index.html, replace placeholders, inline CSS.
 * Wspólna funkcja renderPdfTemplateHtml dla live preview i finalnego PDF.
 * Escapes HTML for plain fields; allows raw HTML for *Html fields (breakdownRowsHtml, addonsListHtml, standardListHtml).
 */

import path from "path";
import fs from "fs";
import {
  mergePdfTemplateConfig,
  mergePdfEditorContent,
  escapeHtml,
  type PdfTemplateConfig,
  type PdfElementPositionId,
  type PdfEditorContent,
} from "@planlux/shared";

export interface OfferPdfPayload {
  offerNumber: string;
  offerDate: string;
  sellerName: string;
  sellerEmail?: string;
  sellerPhone?: string;
  clientName: string;
  companyName?: string;
  personName?: string;
  clientNip?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientAddressOrInstall?: string;
  variantName: string;
  widthM: number;
  lengthM: number;
  heightM?: number;
  areaM2: number;
  constructionType?: string;
  roofType?: string;
  wallsType?: string;
  /** SPECYFIKACJA TECHNICZNA (Konstrukcja, Dach, Ściany) – aliasy dla template {{konstrukcja}}/{{dach}}/{{sciany}}. */
  technicalSpec?: { konstrukcja?: string; dach?: string; sciany?: string };
  priceNet: number;
  priceGross: number;
  /** Table rows HTML (base + addons) */
  breakdownRowsHtml: string;
  /** List HTML for addons (e.g. <li>...) */
  addonsListHtml: string;
  /** Pills HTML for addons (final template page 1) */
  addonsPillsHtml: string;
  /** List HTML for standard "w cenie" */
  standardListHtml: string;
}

/** Konwertuje tekst z nowymi liniami na HTML (każda linia w <div>). */
function linesToHtml(text: string): string {
  const s = String(text ?? "").trim();
  if (!s) return "";
  return s.split(/\r?\n/).map((l) => `<div>${escapeHtml(l)}</div>`).join("");
}

/**
 * Replace placeholders: escape text fields; inject raw HTML for *Html fields.
 * Canonical names: clientName, clientPhone, clientEmail, clientNip, clientAddressOrInstall.
 * Legacy aliases (client_name, phone, email, nip, address) map to same values so old templates still work.
 */
function buildReplacements(p: OfferPdfPayload): Record<string, string> {
  const clientName = escapeHtml(p.clientName ?? "");
  const clientNip = escapeHtml(p.clientNip ?? "");
  const clientEmail = escapeHtml(p.clientEmail ?? "");
  const clientPhone = escapeHtml(p.clientPhone ?? "");
  const clientAddressOrInstall = escapeHtml(p.clientAddressOrInstall ?? "–");
  return {
    "{{offerNumber}}": escapeHtml(p.offerNumber),
    "{{offerDate}}": escapeHtml(p.offerDate),
    "{{sellerName}}": escapeHtml(p.sellerName),
    "{{sellerEmail}}": p.sellerEmail ? escapeHtml(p.sellerEmail) : "",
    "{{sellerPhone}}": p.sellerPhone ? escapeHtml(p.sellerPhone) : "",
    "{{clientName}}": clientName,
    "{{companyName}}": escapeHtml(p.companyName ?? ""),
    "{{personName}}": escapeHtml(p.personName ?? ""),
    "{{clientAddressOrInstall}}": clientAddressOrInstall,
    "{{clientNip}}": clientNip,
    "{{clientEmail}}": clientEmail,
    "{{clientPhone}}": clientPhone,
    "{{variantName}}": escapeHtml(p.variantName),
    "{{widthM}}": new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.widthM),
    "{{lengthM}}": new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.lengthM),
    "{{heightM}}": p.heightM != null ? `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.heightM)} m` : "–",
    "{{areaM2}}": new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.areaM2),
    "{{constructionType}}": escapeHtml((p.constructionType?.trim() || undefined) ?? "(brak danych)"),
    "{{roofType}}": escapeHtml((p.roofType?.trim() || undefined) ?? "(brak danych)"),
    "{{wallsType}}": escapeHtml((p.wallsType?.trim() || undefined) ?? "(brak danych)"),
    "{{konstrukcja}}": escapeHtml((p.technicalSpec?.konstrukcja?.trim() || p.constructionType?.trim() || undefined) ?? "(brak danych)"),
    "{{dach}}": escapeHtml((p.technicalSpec?.dach?.trim() || p.roofType?.trim() || undefined) ?? "(brak danych)"),
    "{{sciany}}": escapeHtml((p.technicalSpec?.sciany?.trim() || p.wallsType?.trim() || undefined) ?? "(brak danych)"),
    "{{priceNet}}": new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.priceNet),
    "{{priceGross}}": new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.priceGross),
    "{{breakdownRowsHtml}}": p.breakdownRowsHtml,
    "{{addonsListHtml}}": p.addonsListHtml,
    "{{addonsPillsHtml}}":
      p.addonsPillsHtml != null && String(p.addonsPillsHtml).trim() !== ""
        ? p.addonsPillsHtml
        : '<span class="pill">Brak dodatków</span>',
    "{{standardListHtml}}": p.standardListHtml ?? "",
    // Legacy aliases – same values as canonical so old template copies still fill
    "{{client_name}}": clientName,
    "{{phone}}": clientPhone,
    "{{email}}": clientEmail,
    "{{nip}}": clientNip,
    "{{address}}": clientAddressOrInstall,
    "{{clientAddress}}": clientAddressOrInstall,
  };
}

const ADDONS_PILLS_FALLBACK = '<span class="pill">Brak dodatków</span>';

function buildConfigReplacements(config: PdfTemplateConfig): Record<string, string> {
  return {
    "{{heroTitle}}": escapeHtml(config.heroTitle),
    "{{heroSubtitle}}": escapeHtml(config.heroSubtitle),
    "{{footerText}}": escapeHtml(config.footerText),
    "{{importantText}}": escapeHtml(config.importantText),
  };
}

const PAGE2_BOX2_TAGS_DEFAULT =
  '<span class="tag">stal • ocynk</span><span class="tag">system modułowy</span><span class="tag">montaż na miejscu</span>';
const PAGE2_BOX3_TAGS_DEFAULT = '<span class="tag">PVC</span><span class="tag">atest</span><span class="tag">szczelność</span>';
const PAGE2_BOX4_TAGS_DEFAULT = '<span class="tag">bramy</span><span class="tag">drzwi</span><span class="tag">wykończenia</span>';

/** Z tekstu spec (np. constructionType) wyciąga słowa kluczowe jako tagi HTML. Fallback gdy brak lub "(brak danych)". */
function specToTagsHtml(text: string | undefined, fallback: string): string {
  const t = (text ?? "").trim();
  if (!t || t === "(brak danych)") return fallback;
  const words = t
    .split(/[\s,•·–—]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
  const take = words.slice(0, 4);
  if (take.length === 0) return fallback;
  return take.map((w) => `<span class="tag">${escapeHtml(w)}</span>`).join("");
}

/** Replacements z editorContent (strony 1–2). Gdy payload podany – tagi box2/3/4 z constructionType/roofType/wallsType. */
function buildEditorContentReplacements(
  editorContent: PdfEditorContent,
  payload?: OfferPdfPayload
): Record<string, string> {
  const p2 = editorContent.page2;
  const noteHtml =
    p2.note?.trim() !== ""
      ? `<section class="spec-note" data-plx-block="SELLER_NOTE" style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;font-size:11px;color:#475569;"><div class="spec-note__text">${escapeHtml(p2.note)}</div></section>`
      : "";
  const emptyPlaceholder = "Brak danych";
  const box2Tags =
    payload != null
      ? specToTagsHtml(payload.constructionType ?? payload.technicalSpec?.konstrukcja, PAGE2_BOX2_TAGS_DEFAULT)
      : PAGE2_BOX2_TAGS_DEFAULT;
  const box3Tags =
    payload != null ? specToTagsHtml(payload.roofType ?? payload.technicalSpec?.dach, PAGE2_BOX3_TAGS_DEFAULT) : PAGE2_BOX3_TAGS_DEFAULT;
  const box4Tags =
    payload != null ? specToTagsHtml(payload.wallsType ?? payload.technicalSpec?.sciany, PAGE2_BOX4_TAGS_DEFAULT) : PAGE2_BOX4_TAGS_DEFAULT;
  return {
    "{{page2SectionTitle}}": escapeHtml("SPECYFIKACJA TECHNICZNA"),
    "{{page2Box1}}": linesToHtml((p2.boxText1 ?? "").trim() || emptyPlaceholder),
    "{{page2Box2}}": linesToHtml((p2.boxText2 ?? "").trim() || emptyPlaceholder),
    "{{page2Box3}}": linesToHtml((p2.boxText3 ?? "").trim() || emptyPlaceholder),
    "{{page2Box4}}": linesToHtml((p2.boxText4 ?? "").trim() || emptyPlaceholder),
    "{{page2Box2Tags}}": box2Tags,
    "{{page2Box3Tags}}": box3Tags,
    "{{page2Box4Tags}}": box4Tags,
    "{{page2NoteSection}}": noteHtml,
  };
}

const DEFAULT_HERO_IMAGE = "assets/hero-bg-print-safe.png";

/** CSS do ukrywania sekcji na stronie oferty (.plx-offer) gdy show* === false. */
function getSectionVisibilityCss(config: PdfTemplateConfig): string {
  const rules: string[] = [];
  if (!config.showMetaBox) rules.push(".plx-offer .hero__meta{display:none !important}");
  if (!config.showPriceSection) rules.push(".plx-offer .price-card{display:none !important}");
  if (!config.showSpecsSection) rules.push(".plx-offer .content .grid{display:none !important}");
  if (!config.showContactSection) rules.push(".plx-offer .footer__right{display:none !important}");
  if (rules.length === 0) return "";
  return `\n/* PdfTemplateConfig section visibility */\n${rules.join("\n")}`;
}

/** Ścieżka tła hero: config.headerImage lub domyślny asset. Zawsze zwraca wartość do url(). */
function getHeroImageUrl(config: PdfTemplateConfig): string {
  if (config.headerImage != null && String(config.headerImage).trim() !== "") {
    return String(config.headerImage).trim().replace(/\\/g, "/");
  }
  return DEFAULT_HERO_IMAGE;
}

/** CSS nadpisujący tło hero (działa w preview i PDF). */
function getHeaderImageCss(config: PdfTemplateConfig): string {
  const url = getHeroImageUrl(config);
  const escaped = url.replace(/'/g, "\\'");
  return `\n/* PdfTemplateConfig headerImage */\n.hero,.plx-offer .hero{background-image:url('${escaped}');}\n`;
}

/** Opcjonalnie: zmienna CSS --plx-accent-color (fallback w template). */
function getAccentColorCss(config: PdfTemplateConfig): string {
  const color = config.accentColor?.trim();
  if (!color) return "";
  return `\n/* PdfTemplateConfig accentColor */\n:root{--plx-accent-color:${color};}\n`;
}

/** CSS nadpisujący gradient headera, czerwone kropki i linię stopki. */
function getConfigOverridesCss(config: PdfTemplateConfig): string {
  const rules: string[] = [];
  const from = config.headerGradientFrom?.trim();
  const to = config.headerGradientTo?.trim();
  if (from && to) {
    const url = getHeroImageUrl(config);
    const escaped = url.replace(/'/g, "\\'");
    rules.push(
      `.hero,.plx-offer .hero{background-image:linear-gradient(180deg,${from} 0%,${to} 100%),url('${escaped}');}`
    );
  }
  if (config.showRedDots === false) {
    rules.push(".plx-offer .pill__dot{display:none !important}");
  }
  if (config.shortFooterLine === true) {
    rules.push(
      ".plx-offer .footer,.footer{border-top:none;position:relative;}",
      ".plx-offer .footer::before,.footer::before{content:'';position:absolute;top:0;left:36px;width:120px;height:1px;background:#e6e8ee;}"
    );
  }
  if (rules.length === 0) return "";
  return `\n/* PdfTemplateConfig overrides (gradient, redDots, shortFooterLine) */\n${rules.join("\n")}\n`;
}

const ELEMENT_POSITION_IDS: PdfElementPositionId[] = [
  "heroTitle",
  "heroSubtitle",
  "metaBox",
  "priceCard",
  "footer",
];

/**
 * Gdy config.elementPositions zawiera pozycje – wstrzykuje CSS ustawiający position/left/top/width/height.
 * Gdy brak pozycji dla elementu – layout z szablonu (CSS) bez zmian.
 */
function getElementPositionsCss(config: PdfTemplateConfig): string {
  const positions = config.elementPositions;
  if (!positions || typeof positions !== "object") return "";
  const rules: string[] = [];
  for (const id of ELEMENT_POSITION_IDS) {
    const pos = positions[id];
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") continue;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
    const decl: string[] = ["position:absolute", `left:${pos.x}px`, `top:${pos.y}px`];
    if (typeof pos.width === "number" && Number.isFinite(pos.width)) decl.push(`width:${pos.width}px`);
    if (typeof pos.height === "number" && Number.isFinite(pos.height)) decl.push(`height:${pos.height}px`);
    rules.push(`.plx-offer [data-plx-element="${id}"]{${decl.join(";")};}`);
  }
  if (rules.length === 0) return "";
  return `\n/* PdfTemplateConfig elementPositions */\n${rules.join("\n")}\n`;
}

function isDev(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production";
}

/**
 * Wspólna funkcja renderująca HTML szablonu PDF.
 * Używana przez: (1) live preview w aplikacji, (2) finalne generowanie PDF.
 * Gdy templateConfig nie podane – używane są defaults (obecny wygląd template).
 * editorContent: edycja stron 1–2; strona 3 zawsze stała.
 * page2Only: gdy true, używamy tylko page2 dla replacements (client z payload, bez merge page1).
 */
export function renderPdfTemplateHtml(
  templateDir: string,
  payload: OfferPdfPayload,
  templateConfig?: Partial<PdfTemplateConfig> | null,
  editorContent?: Partial<PdfEditorContent> | null,
  page2Only?: boolean
): string {
  const config = mergePdfTemplateConfig(templateConfig);
  const editor = editorContent ? mergePdfEditorContent(editorContent) : null;

  const effectivePayload: OfferPdfPayload = { ...payload };
  let effectiveConfig = config;
  if (editor && !page2Only) {
    const p1 = editor.page1;
    if (p1.offerNumber !== undefined && String(p1.offerNumber).trim() !== "") effectivePayload.offerNumber = p1.offerNumber;
    /* Override client fields only when editor has non-empty values. Default merge gives page1 with "" so we must not overwrite payload with empty. */
    if (p1.clientName !== undefined && String(p1.clientName).trim() !== "") effectivePayload.clientName = p1.clientName;
    if (p1.nip !== undefined && String(p1.nip).trim() !== "") effectivePayload.clientNip = p1.nip;
    if (p1.email !== undefined && String(p1.email).trim() !== "") effectivePayload.clientEmail = p1.email;
    if (p1.phone !== undefined && String(p1.phone).trim() !== "") effectivePayload.clientPhone = p1.phone;
    if (p1.leadText !== undefined) {
      effectiveConfig = { ...config, heroSubtitle: p1.leadText };
    }
  }

  /* Logi wyłączone – powodowały spam przy każdym renderze PDF. */

  const indexPath = path.join(templateDir, "index.html");
  const cssPath = path.join(templateDir, "styles.css");
  let html = fs.readFileSync(indexPath, "utf-8");

  const addonsPills =
    payload.addonsPillsHtml != null && String(payload.addonsPillsHtml).trim() !== ""
      ? payload.addonsPillsHtml
      : ADDONS_PILLS_FALLBACK;
  html = html.replace(/\{\{\s*addonsPillsHtml\s*\}\}/g, addonsPills);

  let css = "";
  if (fs.existsSync(cssPath)) {
    css = fs.readFileSync(cssPath, "utf-8");
  }
  css += getSectionVisibilityCss(config);
  if (!(config.headerGradientFrom?.trim() && config.headerGradientTo?.trim())) {
    css += getHeaderImageCss(config);
  }
  css += getAccentColorCss(config);
  css += getElementPositionsCss(config);
  css += getConfigOverridesCss(config);

  const replacements = buildReplacements(effectivePayload);
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  const configReplacements = buildConfigReplacements(effectiveConfig);
  for (const [token, value] of Object.entries(configReplacements)) {
    html = html.split(token).join(value);
  }
  if (editor) {
    const editorReplacements = buildEditorContentReplacements(editor, effectivePayload);
    for (const [token, value] of Object.entries(editorReplacements)) {
      html = html.split(token).join(value);
    }
  } else {
    /* Fallback gdy brak editorContent – domyślne wartości dla page2. */
    const defaults = buildEditorContentReplacements(mergePdfEditorContent(null), effectivePayload);
    for (const [token, value] of Object.entries(defaults)) {
      html = html.split(token).join(value);
    }
  }
  html = html.replace(/\{\{\s*addonsPillsHtml\s*\}\}/g, addonsPills);

  const missingPlaceholders = html.match(/\{\{[^}]+\}\}/g);
  if (missingPlaceholders?.length) {
    const unique = [...new Set(missingPlaceholders)].sort();
    console.warn("[pdf] missing placeholders after replacement:", unique);
  }

  html = html.replace(
    /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/i,
    `<style>${css}</style>`
  );
  return html;
}

/**
 * Read template index.html, apply payload, inline styles.css. Returns full HTML (no external refs).
 * Fallback do renderPdfTemplateHtml bez configu (defaults) – zachowanie jak dotąd.
 */
export function renderTemplate(templateDir: string, payload: OfferPdfPayload): string {
  return renderPdfTemplateHtml(templateDir, payload, undefined);
}

export interface PreviewHtmlResult {
  /** Gotowy HTML do srcDoc iframe (CSS inlined). */
  html: string;
  /** Ścieżka bazowa do assets (np. do rozwiązywania względnych URL w preview). */
  assetsBasePath?: string;
}

/**
 * Helper do live preview: ten sam render co dla PDF.
 * Zwraca HTML do srcDoc oraz opcjonalnie ścieżkę do assets (np. dla base URL w iframe).
 */
export function getPreviewHtmlPayload(
  templateDir: string,
  payload: OfferPdfPayload,
  templateConfig?: Partial<PdfTemplateConfig> | null
): PreviewHtmlResult {
  const html = renderPdfTemplateHtml(templateDir, payload, templateConfig);
  return { html, assetsBasePath: templateDir };
}

const ASSET_REF_REGEX = /(?:src=|url\s*\(\s*)(["']?)(?:\.\/)?assets\/([^"')]+)\1/gi;
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Zamienia odwołania do assets/ w HTML na data URL (base64), żeby iframe srcDoc mógł je załadować.
 */
export function inlineAssetsForPreview(html: string, templateDir: string): string {
  const assetsDir = path.join(templateDir, "assets");
  const seen = new Set<string>();
  let out = html;
  let m: RegExpExecArray | null;
  const regex = new RegExp(ASSET_REF_REGEX.source, "gi");
  while ((m = regex.exec(html)) !== null) {
    const assetPath = m[2].trim();
    if (seen.has(assetPath)) continue;
    seen.add(assetPath);
    const fullPath = path.join(assetsDir, assetPath);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(assetPath).toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      const esc = escapeRegex(assetPath);
      out = out.replace(new RegExp(`(src=)(["'])?(?:\\./)?assets/${esc}\\2`, "gi"), `$1"${dataUrl}"`);
      out = out.replace(
        new RegExp(`(url\\(\\s*)(["']?)(?:\\./)?assets/${esc}\\2(\\s*\\))`, "gi"),
        `$1"${dataUrl}"$3`
      );
    } catch (_) {
      // skip asset on read error
    }
  }
  return out;
}

/**
 * HTML do live preview z inlinowanymi assetami (dla iframe srcDoc).
 */
export function getPreviewHtmlWithInlinedAssets(
  templateDir: string,
  payload: OfferPdfPayload,
  templateConfig?: Partial<PdfTemplateConfig> | null
): string {
  const { html } = getPreviewHtmlPayload(templateDir, payload, templateConfig);
  return inlineAssetsForPreview(html, templateDir);
}
