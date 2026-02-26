# Edytor PDF – instrukcja dla handlowca

## Persystencja danych (Kalkulator ↔ Edytor PDF)

- **Wspólny stan**: Dane z Kalkulatora (wymiary, klient, wariant, dodatki) i Edytora PDF (treści stron 1–2, układ Canva) są zapisywane automatycznie.
- **Przełączanie zakładek**: Przechodząc między Kalkulator a Edytor PDF, dane nie znikają.
- **Zapis**: Stan zapisuje się automatycznie z opóźnieniem ~800 ms po każdej zmianie.

## Wyczyść dane

- **Wyczyść edytor** – resetuje treści edytora PDF i układ Canva. Wymiary i dane klienta zostają.
- **Wyczyść dane** – resetuje wszystko (wymiary, klient, dodatki, treści, układ). Pojawia się dialog potwierdzenia.

## Układ (Canva)

- W sekcji **„Układ (Canva)”** w Edytorze PDF możesz:
  - **Włączać/wyłączać bloki** – przełącznik przy każdym bloku (np. „Wybrane dodatki”, „Notatka handlowca”).
  - **Zmieniać kolejność** – przyciski ▲ ▼ przesuwają blok w górę lub w dół.
  - **Reset układu** – przywraca domyślną widoczność i kolejność dla danej strony.
- Ukryte bloki nie pojawią się w PDF po odświeżeniu podglądu.
- Strona 3 jest zawsze zablokowana – brak bloków Canva.

## Statusy sprzedażowe (MVP)

- W draftzie oferty dostępny jest status: DRAFT, READY_TO_SEND, SENT, ACCEPTED, REJECTED.
- Pełna implementacja (wersje, historia, panel admina) – w następnej iteracji.

## Jak używać

1. Ustaw wymiary i klienta w **Kalkulatorze**.
2. Przejdź do **Edytora PDF** – dane są już dostępne.
3. Kliknij **„Odśwież podgląd”** – wygeneruje się PDF z aktualnymi danymi.
4. Edytuj treści w formularzu lub **klikając w pola na PDF** (inline edycja).
5. W sekcji **Układ (Canva)** ukryj niepotrzebne bloki lub zmień ich kolejność.
6. Ponownie **„Odśwież podgląd”** – PDF odzwierciedli zmiany.
7. **„Generuj PDF”** – zapisuje finalny plik.
