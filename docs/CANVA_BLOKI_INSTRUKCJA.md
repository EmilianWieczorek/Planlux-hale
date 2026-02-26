# Jak dodać nowy blok Canva i mapować regiony inline

## 1. Dodanie nowego bloku

### A) Definicja w `canvaBlocks.ts`

```ts
// W CANVA_BLOCKS dodaj:
{
  id: "NOWY_BLOK",
  page: 1,  // lub 2
  label: "Opis bloku",
  defaultVisible: true,
  domSelector: ".klasa-css",  // opcjonalnie
}
```

### B) Stan domyślny w `offerDraftStore.ts`

W `DEFAULT_CANVA_LAYOUT` dodaj wpis do `page1` lub `page2`:

```ts
{ id: "NOWY_BLOK", visible: true, order: 8 },  // order = następny po ostatnim
```

### C) Atrybut w szablonie HTML

W `packages/desktop/assets/pdf-template/Planlux-PDF/index.html` dodaj `data-plx-block="NOWY_BLOK"` do elementu, który ma być blokiem:

```html
<section class="moja-sekcja" data-plx-block="NOWY_BLOK">
  ...
</section>
```

## 2. Mapowanie regionów inline na blok

Regiony inline (w `editableRegions.ts`) są niezależne od bloków Canva. Aby powiązać region z blokiem:

- **Ukrycie bloku** → regiony wewnątrz niego nie powinny być klikalne. W `PdfPreviewPanel` filtruj regiony: jeśli region należy do ukrytego bloku, nie renderuj hotspotu.
- **Mapowanie region → blok**: Dodaj do `EditableRegion` pole `blockId?: CanvaBlockId`. Przy renderze overlay sprawdzaj `canvaLayout` – jeśli blok jest niewidoczny, pomiń region.

### Przykład w `editableRegions.ts`

```ts
export interface EditableRegion {
  page: 1 | 2;
  id: PdfFieldId;
  label: string;
  x: number; y: number; w: number; h: number;
  kind: "text" | "textarea";
  blockId?: CanvaBlockId;  // opcjonalne powiązanie
}
```

W `PdfPreviewPanel` przy renderze hotspotów:

```ts
const regions = getRegionsForPage(pageNum).filter((r) => {
  if (!r.blockId) return true;
  const block = canvaLayout[`page${pageNum}`].find((b) => b.id === r.blockId);
  return block?.visible !== false;
});
```

## 3. Klik w region → przełączenie na blok w Canva

W `onRegionClick` po przełączeniu taba i fokusie pola możesz przewinąć do odpowiedniego bloku w panelu Canva (np. przez ref + scrollIntoView).
