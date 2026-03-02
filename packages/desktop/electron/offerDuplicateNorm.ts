/**
 * Normalizacja pól do porównania 1:1 w findDuplicateOffers.
 * Eksportowane dla testów i użycia w IPC.
 */
export function digits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

export function norm(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Dzieli "Imię Nazwisko" na first + last (pierwszy token = imię, reszta = nazwisko).
 */
export function splitPersonName(personName: string): { firstName: string; lastName: string } {
  const parts = (personName ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") ?? "",
  };
}
