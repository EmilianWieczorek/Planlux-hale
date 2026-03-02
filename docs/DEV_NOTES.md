# Notatki dla deweloperów

## Testowanie: duplikaty maili

- **Cel:** Jeden klik „Wyślij” = dokładnie jeden e-mail; brak „pustego” dubla.
- **Jak testować:**
  1. Otwórz ofertę → „Wyślij e-mail” → uzupełnij odbiorcę, kliknij **Wyślij**.
  2. Sprawdź skrzynkę odbiorcy: powinna być **jedna** wiadomość z treścią i załącznikiem PDF.
  3. **Test podwójnego kliknięcia:** Kliknij „Wyślij” **dwa razy szybko**. Przycisk powinien być zablokowany („Wysyłanie…”), a po zakończeniu nadal ma dojść **tylko jeden** mail (idempotencja po stronie backendu: `idempotency_key` w `email_history`).
  4. W bazie: `email_history` powinien mieć jeden wpis ze statusem `sent` dla danej oferty + odbiorcy w oknie 5 min.

## Testowanie: PDF strona 2 (Specyfikacja techniczna)

- **Cel:** Strona 2 PDF pokazuje pełną treść (nagłówek + moduły + sekcje); nic nie jest ucięte.
- **Jak testować:**
  1. Wygeneruj PDF oferty (Kalkulator → Generuj PDF lub w szczegółach oferty → Generuj PDF).
  2. Otwórz wygenerowany plik PDF.
  3. Przejdź na **stronę 2** („SPECYFIKACJA TECHNICZNA”).
  4. Sprawdź, czy widać: nagłówek z nr oferty/datą, cztery karty (Dokumentacja, Konstrukcja, Pokrycie dachu, Ściany + stolarka), mini-kafelki (Transport, Montaż, Gwarancja, Realizacja) oraz ewentualną notatkę. Treść nie może być obcięta na dole strony.
  5. W razie pustych pól w modułach wyświetla się placeholder „Brak danych”.
