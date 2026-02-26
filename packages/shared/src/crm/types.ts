/**
 * Typy CRM-lite – oferty, e-mail, event log.
 */

export type OfferStatus = "IN_PROGRESS" | "GENERATED" | "SENT" | "REALIZED";

export interface OfferCrm {
  id: string;
  offerNumber: string;
  userId: string;
  status: OfferStatus;
  createdAt: string;
  pdfGeneratedAt: string | null;
  emailedAt: string | null;
  realizedAt: string | null;
  clientFirstName: string;
  clientLastName: string;
  companyName: string;
  nip: string;
  phone: string;
  email: string;
  variantHali: string;
  widthM: number;
  lengthM: number;
  heightM: number | null;
  areaM2: number;
  hallSummary: string;
  basePricePln: number;
  additionsTotalPln: number;
  totalPln: number;
  standardSnapshot: string; // JSON
  addonsSnapshot: string;   // JSON
  noteHtml: string;
  version: number;
  updatedAt: string;
}

export type EmailHistoryStatus = "QUEUED" | "SENT" | "FAILED";

export interface EmailHistoryRecord {
  id: string;
  offerId: string;
  userId: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  attachmentsJson: string; // JSON array of { name, path }
  sentAt: string | null;
  status: EmailHistoryStatus;
  errorMessage: string | null;
  createdAt: string;
}

export interface EventLogEntry {
  id: string;
  offerId: string | null;
  userId: string;
  eventType: string;
  detailsJson: string; // JSON
  createdAt: string;
}

/** Supported roles: USER (handlowiec), BOSS (manager), ADMIN */
export type UserRole = "USER" | "SALESPERSON" | "BOSS" | "MANAGER" | "ADMIN";
