/**
 * Shared types for Planlux Hale.
 */

export type UserRole = "ADMIN" | "BOSS" | "SALESPERSON";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  displayName?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientJson {
  name: string;
  nip?: string;
  email?: string;
  phone?: string;
}

export interface HallJson {
  variantHali: string;
  variantNazwa?: string;
  widthM: number;
  lengthM: number;
  heightM?: number;
  areaM2: number;
}

export interface SelectedAddition {
  nazwa: string;
  ilosc: number;
  jednostka?: string;
}

export interface PricingJson {
  basePln: number;
  addonsPln: number;
  totalPln: number;
  breakdown: {
    base: { label: string; amount: number };
    addons: Array<{ label: string; amount: number; unit?: string }>;
    standardIncluded: Array<{ label: string; valueRef: number }>;
  };
}

export type OfferStatus = "draft" | "sent" | "archived";
export type PdfStatus = "LOCAL" | "LOGGED";
export type EmailStatus = "DO_WYSŁANIA" | "SENT" | "FAILED";
export type OutboxStatus = "pending" | "processing" | "done" | "failed";
