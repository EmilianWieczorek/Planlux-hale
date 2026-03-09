# Checklista testowa PDF — dla handlowca

**Aplikacja:** Planlux Hale  
**Cel:** Sprawdzenie, że generowanie ofert PDF (podgląd i finalny plik) działa poprawnie przed wdrożeniem.

---

## Środowisko

- [ ] **Dev:** `npm run dev:desktop` — aplikacja uruchomiona z katalogu projektu
- [ ] **Build (opcjonalnie):** Zbudowana wersja instalatora, zainstalowana na maszynie testowej

---

## 1. Pełna oferta

- [ ] Otwórz Kalkulator, uzupełnij: wariant hali, wymiary, **pełna nazwa firmy**, **adres**, NIP, e-mail, telefon
- [ ] Dodaj kilka dodatków (np. brama, ocieplenie)
- [ ] Kliknij **Podgląd PDF** — czy podgląd się otwiera?
- [ ] W podglądzie: czy widać **logo Planlux**, **nagłówek (tło – kolor lub obrazek)**, **dane klienta**, **tabelę wyceny**, **dodatki**, **strony 2 i 3**?
- [ ] Kliknij **Generuj PDF** — czy pojawia się komunikat sukcesu i czy plik jest zapisany (np. w Dokumenty/Planlux Hale lub wskazanym folderze)?
- [ ] Otwórz wygenerowany PDF w przeglądarce/Adobe — czy wygląda tak samo jak podgląd? Czy **polskie znaki** (ą, ę, ó, ł, ż, ź, ć, ń) są poprawne?

---

## 2. Oferta bez firmy (osoba fizyczna)

- [ ] Ustaw **tylko imię i nazwisko** (bez nazwy firmy)
- [ ] Wygeneruj podgląd i finalny PDF
- [ ] Czy w miejscu „Zamawiający” / „Klient” widać imię i nazwisko? Czy brak firmy nie psuje układu?

---

## 3. Długa nazwa firmy

- [ ] Wpisz **bardzo długą nazwę firmy** (np. 80+ znaków)
- [ ] Wygeneruj PDF (podgląd + finalny)
- [ ] Czy tekst **zawija się** w ramce, czy wylewa się poza kartę / przycina?

---

## 4. Długi adres

- [ ] Wpisz **długi adres** (kilka linii, np. ulica + kod + miejscowość + województwo)
- [ ] Wygeneruj PDF
- [ ] Czy adres **zawija się** poprawnie w polu „Adres” i w chipie „Montaż”? Czy nic nie jest ucięte?

---

## 5. Wieloma dodatkami

- [ ] Dodaj **wiele dodatków** (np. 8–10: bramy, ocieplenie, świetliki, itd.)
- [ ] Wygeneruj PDF
- [ ] Czy **wszystkie dodatki** są na liście / w pills? Czy **druga strona** (Specyfikacja) i **strona 3** (Przygotowanie terenu) nadal mają poprawny układ?

---

## 6. Kilka bram

- [ ] Wybierz wariant z **kilkoma bramami** (jeśli dostępny w cenniku)
- [ ] Wygeneruj PDF
- [ ] Czy bramy są poprawnie w tabeli wyceny i w dodatkach? Czy cena się sumuje?

---

## 7. Oferta wielostronicowa

- [ ] Stwórz ofertę, która **na pewno ma 3 strony** (dużo dodatków + długa treść)
- [ ] Wygeneruj PDF
- [ ] Czy **łamanie stron** jest poprawne (np. nagłówek nie ucięty, stopka na dole strony)? Czy **strona 2 i 3** mają ten sam styl nagłówka (tło / kolor)?

---

## 8. Preview w dev

- [ ] W trybie **dev** (`npm run dev:desktop`) otwórz podgląd PDF dla dowolnej oferty
- [ ] Czy podgląd ładuje się w **rozsądnym czasie** (kilka sekund)?
- [ ] Czy **logo i tło** są widoczne? Czy nie ma pustych białych ramek (poza miejscem na diagram, jeśli nie ma pliku diagramu)?

---

## 9. Finalny PDF w dev

- [ ] W **dev** wygeneruj finalny PDF („Generuj PDF”)
- [ ] Czy plik pojawia się w oczekiwanym folderze?
- [ ] Czy po otwarciu PDF **zawartość jest identyczna** z podglądem (te same dane, ten sam układ)?

---

## 10. Finalny PDF po buildzie

- [ ] Zbuduj aplikację (np. `npm run build`, potem budowanie instalatora)
- [ ] Zainstaluj i uruchom **zbudowaną** wersję (nie z npm run dev)
- [ ] Wygeneruj **finalny PDF** z poziomu zainstalowanej aplikacji
- [ ] Czy generowanie **nie kończy się błędem**? Czy PDF ma **logo i nagłówek** (tło lub gradient)? Czy **ścieżka do pliku** jest poprawna (np. w folderze użytkownika)?

---

## Błędy do zgłoszenia

Przy każdym problemie zanotuj:

- **Krok:** np. „Podgląd PDF”, „Generuj PDF po buildzie”
- **Scenariusz:** np. „Oferta z długą nazwą firmy”
- **Co się stało:** np. „Pusta ramka zamiast logo”, „Błąd: Szablon nie znaleziony”
- **Środowisko:** Dev / Build, system (Windows wersja)

---

**Koniec checklisty.**
