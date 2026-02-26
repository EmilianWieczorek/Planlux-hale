# Raport: reset buildu i test PDF (biała kreska w headerze)

Data: 2026-02-24

## 1) Log wykonania kroków 1–5

| Krok | Akcja | Wynik |
|------|--------|--------|
| **1** | Usunięto `packages/desktop/dist` | Usunięto; katalog nie istniał po resecie. |
| **2** | Pełny build: `npm run build` (root) | Sukces. Usunięto `scaleFactor` z `generatePdf.ts` (TS: PrintToPDFOptions). `packages/desktop/dist` odtworzony z `copy:assets` (m.in. `dist/assets/pdf-template/Planlux-PDF/` + `hero-bg-print-safe.png`). |
| **3** | Generowanie testowego PDF | Uruchomiono `npm run test:pdf` w `packages/desktop`. PDF zapisany pod unikalną nazwą z timestampem. |
| **4** | Logi `templateDir` i ścieżki | Wykorzystano logi z konsoli (patrz sekcja 2). Runtime używa **źródłowego** template (assets), nie dist. |
| **5** | Test w viewerze i druku | Do wykonania ręcznie – checklista poniżej. |

---

## 2) Ścieżki runtime (z logów generowania)

- **templateDir:**  
  `C:\Users\emilw\Desktop\Planlux hale\packages\desktop\assets\pdf-template\Planlux-PDF`
- **styles.css (pełna ścieżka):**  
  `C:\Users\emilw\Desktop\Planlux hale\packages\desktop\assets\pdf-template\Planlux-PDF\styles.css`
- **hero-bg-print-safe.png (pełna ścieżka):**  
  `C:\Users\emilw\Desktop\Planlux hale\packages\desktop\assets\pdf-template\Planlux-PDF\assets\hero-bg-print-safe.png`
- **template source (z logu):**  
  `packages/desktop/assets (dev)` – czyli **nie** `dist`, tylko katalog źródłowy (aktualnie edytowany).

---

## 3) Informacje o pliku PNG

| Pole | Wartość |
|------|--------|
| **exists** | tak |
| **size** | 86 000 bajtów |
| **mtime** | 2026-02-24T09:38:16.347Z |

Ścieżka: `packages/desktop/assets/pdf-template/Planlux-PDF/assets/hero-bg-print-safe.png`.  
Runtime ładuje ten sam plik (potwierdzenie w logach: ta ścieżka + exists + size/mtime).

---

## 4) Ścieżka i nazwa nowego PDF

- **Pełna ścieżka:**  
  `C:\Users\emilw\Documents\Planlux Hale\output\OF-20260224-oferta-test-1771926704292-Test_Klient_Sp_z_oo.pdf`
- **Nazwa pliku:**  
  `OF-20260224-oferta-test-1771926704292-Test_Klient_Sp_z_oo.pdf`
- **Czas wygenerowania:**  
  przy uruchomieniu `test:pdf` (timestamp w nazwie: 1771926704292).

---

## 5) Podsumowanie końcowe

- **Czy problem wygląda na stary cache/dist?**  
  Nie – wykonano pełny reset `dist`, przebudowano projekt i wygenerowano PDF. Przy uruchomieniu `electron .` z `packages/desktop` używany jest **katalog źródłowy** `assets/pdf-template/Planlux-PDF`, a nie `dist`. Stary dist nie jest w tym trybie używany.
- **Czy runtime ładuje właściwe pliki?**  
  Tak. Logi potwierdzają: templateDir → source assets, pełne ścieżki do `styles.css` i `hero-bg-print-safe.png`, exists, size i mtime PNG zgodne z plikiem na dysku. Renderer zgłasza `backgroundImage`: `file:///.../tmp/.../assets/hero-bg-print-safe.png` (kopia z template do userData/tmp).
- **Czy kreska występuje w viewerze / w druku?**  
  Wymaga ręcznego sprawdzenia – poniżej checklista.

---

## Checklista: test w viewerze i druku (krok 5)

Wykonaj ręcznie i odnotuj wyniki (możesz odesłać screen lub krótki opis).

1. **Otwórz nowy PDF w co najmniej 2 viewerach**
   - Ścieżka: `C:\Users\emilw\Documents\Planlux Hale\output\OF-20260224-oferta-test-1771926704292-Test_Klient_Sp_z_oo.pdf`
   - [ ] **Adobe Acrobat Reader** – czy przy prawej krawędzi headera widać białą pionową kreskę? (tak/nie)
   - [ ] **Edge lub Chrome** (otwórz plik w przeglądarce) lub inny viewer – to samo pytanie. (tak/nie)

2. **Ustawienia podglądu/druku**
   - Zoom: **100%** / „Rzeczywisty rozmiar”.
   - Wyłącz **„Dopasuj do strony”** / Fit to page.

3. **Druk na PDF (driver)**
   - [ ] Drukuj z dowolnego viewera przez **Microsoft Print to PDF** (lub inny driver „Print to PDF”).
   - [ ] Otwórz **wydrukowany** PDF – czy biała kreska jest widoczna? (tak/nie)

4. **Co odesłać**
   - Krótkie odpowiedzi: kreska w Acrobat? w Edge/Chrome? po „Print to PDF”?
   - Opcjonalnie: zrzut ekranu headera w jednym viewerze (z kreską lub bez).

---

*Wygenerowano po resecie buildu i `npm run test:pdf`. Nie zmieniano layoutu ani CSS poza wcześniejszą diagnostyką.*
