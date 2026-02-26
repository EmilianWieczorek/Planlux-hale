/**
 * Typy request/response dla backendu Apps Script.
 */

export interface MetaResponse {
  version: number;
  lastUpdated: string;
}

export interface CennikRow {
  "Nr."?: number;
  wariant_hali: string;
  Nazwa: string;
  Typ_Konstrukcji?: string;
  Typ_Dachu?: string;
  Boki?: string;
  Dach?: string;
  area_min_m2: number;
  area_max_m2: number;
  /** @deprecated No longer used in pricing; matching is by area only. */
  max_width_m?: number;
  cena: number;
  stawka_jednostka?: string;
  uwagi?: string;
}

export interface DodatkiRow {
  Nr?: number;
  wariant_hali: string;
  Nazwa?: string;
  nazwa: string;
  stawka: number;
  jednostka: string;
  warunek?: string;
  warunek_type?: string;
  warunek_min?: number | string;
  warunek_max?: number | string;
}

export interface StandardRow {
  Nr?: number;
  wariant_hali: string;
  element: string;
  ilosc?: number;
  jednostka?: string;
  wartosc_ref: number | string;
  stawka?: string;
  Jednostka?: string;
  uwagi?: string;
}

export interface BaseResponse {
  ok: boolean;
  meta: MetaResponse;
  generatedAt?: string;
  debug?: { counts: { cennik: number; dodatki: number; standard: number } };
  cennik: CennikRow[];
  dodatki: DodatkiRow[];
  standard: StandardRow[];
}

export interface MetaOnlyResponse {
  ok: boolean;
  meta: MetaResponse;
  generatedAt?: string;
}

export interface LogPdfPayload {
  id: string;
  userId: string;
  userEmail: string;
  clientName: string;
  variantHali: string;
  widthM: number;
  lengthM: number;
  heightM?: number;
  areaM2: number;
  totalPln: number;
  fileName: string;
  createdAt: string;
}

export interface LogEmailPayload {
  id: string;
  userId: string;
  userEmail: string;
  toEmail: string;
  subject: string;
  status: "SENT" | "FAILED";
  pdfId?: string;
  sentAt: string | null;
  errorMessage?: string;
}

export interface HeartbeatPayload {
  id: string;
  userId: string;
  userEmail: string;
  deviceType: "desktop" | "phone";
  appVersion: string;
  occurredAt: string;
}

export interface ReserveOfferNumberPayload {
  id: string;
  idempotencyKey?: string;
  userId: string;
  initial: string;
  year: number;
}

export interface ReserveOfferNumberResponse {
  ok: boolean;
  offerNumber?: string;
  id?: string;
  error?: string;
}

export type OutboxOperationType = "SEND_EMAIL" | "LOG_PDF" | "LOG_EMAIL" | "HEARTBEAT" | "OFFER_SYNC";

export interface OutboxPayloadMap {
  SEND_EMAIL: { emailId: string; to: string; subject: string; body: string; attachmentPath?: string };
  LOG_PDF: LogPdfPayload;
  LOG_EMAIL: LogEmailPayload;
  HEARTBEAT: HeartbeatPayload;
  OFFER_SYNC: { offers: unknown[]; lastSync?: string };
}
