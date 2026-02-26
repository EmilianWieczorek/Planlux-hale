# Kontrakt API – Backend (Google Apps Script Web App)

Base URL: `https://script.google.com/macros/s/AKfycbzOCqNNK5c2trwE-Q-w6ti89Q-Img8IxH5axqLZImPLFNF3zyPCtqHE0lOKMYnuwt8H/exec`

Wszystkie odpowiedzi JSON. Opcjonalnie: nagłówek `X-App-Token: <token>` dla operacji POST (jeśli backend weryfikuje).

---

## 1. GET META (wersja bazy – lekki check)

**Request:**  
`GET {baseUrl}?action=meta`

**Response 200:**

```json
{
  "ok": true,
  "meta": {
    "version": 158,
    "lastUpdated": "2026-02-20T23:36:24.726Z"
  },
  "generatedAt": "2026-02-21T00:37:41.221Z"
}
```

Aplikacja porównuje `meta.version` z lokalnym `pricing_version`. Jeśli zdalna wersja jest większa – pobiera pełną bazę (`action=base`).

---

## 2. GET BASE (pełna baza: cennik, dodatki, standard)

**Request:**  
`GET {baseUrl}?action=base`

**Response 200:**

```json
{
  "ok": true,
  "meta": {
    "version": 158,
    "lastUpdated": "2026-02-20T23:36:24.726Z"
  },
  "generatedAt": "2026-02-21T00:38:41.820Z",
  "debug": { "counts": { "cennik": 23, "dodatki": 30, "standard": 17 } },
  "cennik": [
    {
      "Nr.": 1,
      "wariant_hali": "T18_T35_DACH",
      "Nazwa": "Hala całość z T-18 + T-35 dach",
      "Typ_Konstrukcji": "Słupowo/Kratowa - ocynkowana ogniowo",
      "Typ_Dachu": "Blacha T-35",
      "Boki": "Blacha T-18",
      "Dach": "Blacha T-35",
      "area_min_m2": 100,
      "area_max_m2": 150,
      "max_width_m": 12,
      "cena": 650,
      "stawka_jednostka": "zł/mkw",
      "uwagi": ""
    }
  ],
  "dodatki": [
    {
      "Nr": 1,
      "wariant_hali": "T18_T35_DACH",
      "Nazwa": "Hala całość z T-18 + T-35 dach",
      "nazwa": "Dopłata za wysokość",
      "stawka": 40,
      "jednostka": "m2",
      "warunek": "wysokość 5,01–6 m",
      "warunek_type": "HEIGHT_RANGE",
      "warunek_min": 5.01,
      "warunek_max": 6
    }
  ],
  "standard": [
    {
      "Nr": 1,
      "wariant_hali": "T18_T35_DACH",
      "element": "DRZWI_TECHNICZNE",
      "ilosc": 1,
      "jednostka": "szt",
      "wartosc_ref": 4000,
      "stawka": "zł",
      "Jednostka": "szt",
      "uwagi": ""
    }
  ]
}
```

Jednostki w danych: m2, mb, szt, kpl. Warunki: `HEIGHT_RANGE` / `RANGE` z `warunek_min`, `warunek_max` (wysokość/dopłaty ściana boczna). Wartości liczbowe mogą przychodzić jako string (np. `"4 000"`) – aplikacja normalizuje do number.

---

## 3. POST LOG PDF (logowanie wygenerowanego PDF do Sheets)

**Request:**  
`POST {baseUrl}`  
Content-Type: `application/json`

```json
{
  "action": "logPdf",
  "payload": {
    "id": "pdf-uuid-123",
    "userId": "user-uuid",
    "userEmail": "jan@planlux.pl",
    "clientName": "Firma ABC Sp. z o.o.",
    "variantHali": "T18_T35_DACH",
    "widthM": 12,
    "lengthM": 20,
    "heightM": 5.5,
    "areaM2": 240,
    "totalPln": 135600,
    "fileName": "Oferta_Planlux_Firma_ABC_2026-02-21.pdf",
    "createdAt": "2026-02-21T10:00:00.000Z"
  }
}
```

**Response 200:**

```json
{
  "ok": true,
  "message": "logged",
  "id": "pdf-uuid-123"
}
```

**Response 4xx/5xx:**

```json
{
  "ok": false,
  "error": "Invalid payload",
  "code": "VALIDATION_ERROR"
}
```

Idempotency: backend może użyć `id` do wykrycia duplikatu i zwrócić 200 bez ponownego dopisywania.

---

## 4. POST LOG EMAIL (logowanie wysłanego e-maila)

**Request:**  
`POST {baseUrl}`  
Content-Type: `application/json`

```json
{
  "action": "logEmail",
  "payload": {
    "id": "email-uuid-456",
    "userId": "user-uuid",
    "userEmail": "jan@planlux.pl",
    "toEmail": "klient@firma.pl",
    "subject": "Oferta Planlux Hale – Firma ABC",
    "status": "SENT",
    "pdfId": "pdf-uuid-123",
    "sentAt": "2026-02-21T10:05:00.000Z"
  }
}
```

Dla statusu `FAILED`:

```json
{
  "action": "logEmail",
  "payload": {
    "id": "email-uuid-456",
    "userId": "user-uuid",
    "userEmail": "jan@planlux.pl",
    "toEmail": "klient@firma.pl",
    "subject": "Oferta Planlux Hale",
    "status": "FAILED",
    "errorMessage": "SMTP connection timeout",
    "sentAt": null
  }
}
```

**Response 200:**

```json
{
  "ok": true,
  "message": "logged",
  "id": "email-uuid-456"
}
```

---

## 5. POST HEARTBEAT (aktywność użytkownika)

**Request:**  
`POST {baseUrl}`  
Content-Type: `application/json`

```json
{
  "action": "heartbeat",
  "payload": {
    "id": "heartbeat-uuid-789",
    "userId": "user-uuid",
    "userEmail": "jan@planlux.pl",
    "deviceType": "desktop",
    "appVersion": "1.0.0",
    "occurredAt": "2026-02-21T10:00:00.000Z"
  }
}
```

`deviceType`: `"desktop"` | `"phone"`.

**Response 200:**

```json
{
  "ok": true,
  "message": "recorded",
  "id": "heartbeat-uuid-789"
}
```

---

## 6. GET LOGIN / AUTH (opcjonalnie – jeśli logowanie przez backend)

Jeśli backend ma przechowywać użytkowników (np. w Sheets) i weryfikować hasło:

**Request:**  
`POST {baseUrl}`  
Content-Type: `application/json`

```json
{
  "action": "login",
  "payload": {
    "email": "jan@planlux.pl",
    "passwordHash": "<hash z aplikacji lub jednorazowy token>"
  }
}
```

Rekomendacja MVP: użytkownicy i hasła tylko lokalnie w SQLite; backend nie zna haseł. Admin może mieć endpoint `listUsers` / `createUser` zabezpieczony tokenem admina (np. do synchronizacji listy użytkowników między urządzeniami – opcjonalnie).

---

## 7. GET HISTORY (dla panelu admina)

**Request:**  
`GET {baseUrl}?action=historyPdf&token={adminToken}`  
`GET {baseUrl}?action=historyEmail&token={adminToken}`  
`GET {baseUrl}?action=activity&token={adminToken}`

**Response 200 (przykład historyPdf):**

```json
{
  "ok": true,
  "data": [
    {
      "id": "pdf-uuid-123",
      "userEmail": "jan@planlux.pl",
      "clientName": "Firma ABC",
      "variantHali": "T18_T35_DACH",
      "areaM2": 240,
      "totalPln": 135600,
      "fileName": "Oferta_Planlux_Firma_ABC_2026-02-21.pdf",
      "createdAt": "2026-02-21T10:00:00.000Z"
    }
  ]
}
```

Backend czyta z arkuszy HISTORIA_PDF, HISTORIA_EMAIL, ACTIVITY i zwraca tylko przy poprawnym `token` (admin).
