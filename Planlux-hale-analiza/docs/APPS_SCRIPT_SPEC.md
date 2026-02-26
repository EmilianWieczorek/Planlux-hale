# Apps Script Backend – Specyfikacja endpointów CRM

**Base URL:** `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`

---

## Arkusze Google Sheets

| Arkusz | Kolumny (przykład) |
|--------|---------------------|
| **Offers** | id, offer_number, user_id, status, created_at, pdf_generated_at, emailed_at, realized_at, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, version, updated_at |
| **EmailHistory** | id, offer_id, user_id, from_email, to_email, subject, body, attachments_json, sent_at, status, error_message, created_at |
| **Events** | id, offer_id, user_id, event_type, details_json, created_at |
| **Counters** | id (userId-year), user_id, year, next_seq, updated_at |
| **Pricing** | (istniejący: CENNIK, DODATKI, STANDARD) |
| **Users** | (istniejący) |
| **Activity** | (istniejący: heartbeat) |

---

## Routing (doGet / doPost)

```javascript
function doGet(e) {
  const action = e.parameter.action;
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    switch (action) {
      case 'meta': return output.setContent(JSON.stringify(handleMeta(e))); break;
      case 'base': return output.setContent(JSON.stringify(handleBase(e))); break;
      case 'offers': return output.setContent(JSON.stringify(handleGetOffers(e))); break;
      case 'emailHistory': return output.setContent(JSON.stringify(handleGetEmailHistory(e))); break;
      case 'counters': return output.setContent(JSON.stringify(handleGetCounters(e))); break;
      case 'duplicates': return output.setContent(JSON.stringify(handleDuplicates(e))); break;
      case 'dashboard': return output.setContent(JSON.stringify(handleDashboard(e))); break;
      default: return output.setContent(JSON.stringify({ ok: false, error: 'Unknown action' }));
    }
  } catch (err) {
    return output.setContent(JSON.stringify({ ok: false, error: err.message, code: 'SERVER_ERROR' }));
  }
}

function doPost(e) {
  const postData = JSON.parse(e.postData.contents);
  const action = postData.action;
  const payload = postData.payload || {};
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    switch (action) {
      case 'logPdf': return output.setContent(JSON.stringify(handleLogPdf(payload))); break;
      case 'logEmail': return output.setContent(JSON.stringify(handleLogEmail(payload))); break;
      case 'heartbeat': return output.setContent(JSON.stringify(handleHeartbeat(payload))); break;
      case 'offer': return output.setContent(JSON.stringify(handlePostOffer(payload))); break;
      case 'emailHistory': return output.setContent(JSON.stringify(handlePostEmailHistory(payload))); break;
      case 'reserveNumber': return output.setContent(JSON.stringify(handleReserveNumber(payload))); break;
      default: return output.setContent(JSON.stringify({ ok: false, error: 'Unknown action' }));
    }
  } catch (err) {
    return output.setContent(JSON.stringify({ ok: false, error: err.message, code: 'SERVER_ERROR' }));
  }
}
```

---

## POST reserveNumber

**Request:**
```json
{
  "action": "reserveNumber",
  "payload": {
    "id": "req-uuid",
    "idempotencyKey": "reserve-user-uuid-1739000000000",
    "userId": "user-uuid",
    "year": 2026
  }
}
```

**Logika:**
1. LockService.getScriptLock().lock(5000)
2. Pobierz wiersz Counters dla `userId-year`
3. Jeśli brak – utwórz z next_seq=1
4. next_seq++ → zapisz
5. Inicjał: pierwsza litera imienia handlowca (Users) lub "X"
6. Zwróć `PLX-{initial}{seq.padStart(4,'0')}/{year}`
7. releaseLock()

**Response:**
```json
{
  "ok": true,
  "offerNumber": "PLX-E0001/2026",
  "id": "req-uuid"
}
```

---

## GET offers?lastSync=ISO8601

**Logika:**
- Odczyt z arkusza Offers
- Filtruj: updated_at > lastSync
- Zwróć tablicę ofert + meta.offersVersion

**Response:**
```json
{
  "ok": true,
  "offers": [...],
  "meta": { "offersVersion": 42 }
}
```

---

## POST offer (idempotentne)

**Payload:** pełny obiekt Offer (id, offerNumber, userId, status, version, updatedAt, ...)

**Logika:**
1. Sprawdź idempotencyKey – jeśli już przetworzony: zwróć 200 z poprzednim wynikiem
2. Szukaj wiersza po id
3. Jeśli istnieje i version zdalny >= lokalny: ignoruj (duplikat)
4. W przeciwnym razie: INSERT lub UPDATE (Last Write Wins)

**Response:**
```json
{
  "ok": true,
  "id": "offer-uuid",
  "offerNumber": "PLX-E0001/2026",
  "version": 2
}
```

---

## GET duplicates?query=base64(JSON)

**Query (JSON):**
```json
{
  "firstName": "Jan",
  "lastName": "Kowalski",
  "companyName": "Firma ABC",
  "nip": "1234567890",
  "phone": "48123456789"
}
```

**Normalizacja:** trim, lowercase, usuń spacje, usuń znaki niealfanumeryczne z NIP/telefon

**Logika:** szukaj w Offers po: company_name LIKE, nip LIKE, phone LIKE, (first_name + last_name) LIKE

**Response:**
```json
{
  "ok": true,
  "matches": [
    {
      "offerId": "...",
      "offerNumber": "PLX-E0042/2025",
      "userId": "...",
      "userDisplayName": "Jan Kowalski",
      "createdAt": "2025-11-15T10:00:00Z"
    }
  ]
}
```

---

## GET dashboard?period=YYYY-MM

**Logika:** agregacja z Offers: per user_id, count(status=created), count(status=sent), count(status=realized)

**Response:**
```json
{
  "ok": true,
  "period": "2026-02",
  "byUser": [
    {
      "userId": "...",
      "displayName": "Jan Kowalski",
      "created": 12,
      "sent": 8,
      "realized": 3
    }
  ]
}
```

---

## Idempotency

- Każdy POST z payload.idempotencyKey
- Arkusz: IdempotencyKeys (idempotency_key, response_json, created_at)
- Przy duplikacie: zwróć zapisany response_json, status 200
