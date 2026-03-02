/**
 * Testy: normalizacja do porównań 1:1 duplikatów ofert (NIP, telefon, e-mail, firma, osoba).
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { digits, norm, splitPersonName } from "./offerDuplicateNorm";

describe("offerDuplicateNorm", () => {
  describe("digits", () => {
    it("zostawia tylko cyfry", () => {
      expect(digits("123")).toBe("123");
      expect(digits("12-34-56-78-90")).toBe("1234567890");
      expect(digits("+48 123 456 789")).toBe("48123456789");
      expect(digits("")).toBe("");
      expect(digits("abc")).toBe("");
    });
  });

  describe("norm", () => {
    it("lowercase, trim, pojedyncze spacje", () => {
      expect(norm("  Jan   Kowalski  ")).toBe("jan kowalski");
      expect(norm("FIRMA ABC SP. Z O.O.")).toBe("firma abc sp. z o.o.");
      expect(norm("a@b.pl")).toBe("a@b.pl");
    });
  });

  describe("splitPersonName", () => {
    it("pierwszy token = imię, reszta = nazwisko", () => {
      expect(splitPersonName("Jan Kowalski")).toEqual({ firstName: "Jan", lastName: "Kowalski" });
      expect(splitPersonName("Jan Maria Kowalski")).toEqual({ firstName: "Jan", lastName: "Maria Kowalski" });
      expect(splitPersonName("Jan")).toEqual({ firstName: "Jan", lastName: "" });
      expect(splitPersonName("")).toEqual({ firstName: "", lastName: "" });
    });
  });
});
