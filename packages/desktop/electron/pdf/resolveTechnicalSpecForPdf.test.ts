/**
 * resolveTechnicalSpecForPdf: exact match, alias match, Supabase error -> SQLite, no record -> fallback, partial empty.
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveTechnicalSpecForPdf,
  resolveTechnicalSpecFromSupabase,
  getPossibleMatchValues,
  VARIANT_ALIASES,
} from "./resolveTechnicalSpecForPdf";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
};

describe("resolveTechnicalSpecForPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fallback when variant empty", async () => {
    const result = await resolveTechnicalSpecForPdf("", { logger });
    expect(result).toEqual({
      construction_type: "(brak danych)",
      roof_type: "(brak danych)",
      walls: "(brak danych)",
    });
    expect(logger.warn).toHaveBeenCalledWith("[pdf] technical spec resolver fallback reason", expect.any(Object));
  });

  it("fallback when no getSupabase and no getDb", async () => {
    const result = await resolveTechnicalSpecForPdf("PLYTA_WARSTWOWA", { logger });
    expect(result.construction_type).toBe("(brak danych)");
    expect(result.roof_type).toBe("(brak danych)");
    expect(result.walls).toBe("(brak danych)");
    expect(logger.info).toHaveBeenCalledWith(
      "[pdf] technical spec resolver result",
      expect.objectContaining({ source: "fallback", recordFound: false })
    );
  });

  it("Supabase returns row -> use Supabase source", async () => {
    const exactPayload = {
      data: [
        {
          id: "1",
          variant: "PLYTA_WARSTWOWA",
          name: "Płyta warstwowa",
          construction_type: "Konstrukcja stalowa",
          roof_type: "PVC",
          walls: "Płyta warstwowa",
        },
      ],
      error: null,
    };
    const mockLimit = vi.fn().mockResolvedValue(exactPayload);
    const mockEq = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
    const getSupabase = vi.fn().mockReturnValue({ from: mockFrom });
    const result = await resolveTechnicalSpecForPdf("PLYTA_WARSTWOWA", {
      getSupabase: () => getSupabase(),
      logger,
    });
    expect(result.construction_type).toBe("Konstrukcja stalowa");
    expect(result.roof_type).toBe("PVC");
    expect(result.walls).toBe("Płyta warstwowa");
    expect(logger.info).toHaveBeenCalledWith(
      "[pdf] technical spec resolver result",
      expect.objectContaining({ source: "Supabase", recordFound: true })
    );
  });

  it("Supabase query error -> null from Supabase, then try SQLite or fallback", async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "column pricing_surface.area_min_m2 does not exist", code: "42703" },
    });
    const mockEq = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
    const getSupabase = vi.fn().mockReturnValue({ from: mockFrom });
    const result = await resolveTechnicalSpecForPdf("T18_T35_DACH", {
      getSupabase: () => getSupabase(),
      logger,
    });
    expect(result.construction_type).toBe("(brak danych)");
    expect(logger.warn).toHaveBeenCalledWith(
      "[pdf] technical spec resolver Supabase query error (exact)",
      expect.objectContaining({ message: expect.any(String), code: "42703" })
    );
  });

  it("Supabase no match (variant mismatch) -> fallback", async () => {
    const mockLimitExact = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockLimitIlike = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEq = vi.fn().mockReturnValue({ limit: mockLimitExact });
    const mockIlike = vi.fn().mockReturnValue({ limit: mockLimitIlike });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, ilike: mockIlike });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
    const getSupabase = vi.fn().mockReturnValue({ from: mockFrom });
    const result = await resolveTechnicalSpecForPdf("PLYTA_WARSTWOWA", {
      getSupabase: () => getSupabase(),
      logger,
    });
    expect(result.construction_type).toBe("(brak danych)");
    expect(logger.warn).toHaveBeenCalledWith(
      "[pdf] technical spec resolver Supabase no match",
      expect.objectContaining({ inputVariant: "PLYTA_WARSTWOWA", normalizedVariant: "PLYTA_WARSTWOWA", tried: "eq and ilike" })
    );
  });

  it("record exists but one field empty -> that field fallback", async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      data: [
        {
          id: "1",
          variant: "PLANDEKA_T18",
          name: "Plandeka T18",
          construction_type: "Stal",
          roof_type: "",
          walls: "Plandeka",
        },
      ],
      error: null,
    });
    const mockEq = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
    const getSupabase = vi.fn().mockReturnValue({ from: mockFrom });
    const result = await resolveTechnicalSpecForPdf("PLANDEKA_T18", {
      getSupabase: () => getSupabase(),
      logger,
    });
    expect(result.construction_type).toBe("Stal");
    expect(result.roof_type).toBe("(brak danych)");
    expect(result.walls).toBe("Plandeka");
  });
});

describe("resolveTechnicalSpecFromSupabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects only safe columns (no area_min_m2)", async () => {
    const selectCalls: string[] = [];
    const mockLimit = vi.fn().mockResolvedValue({
      data: [
        { id: "1", variant: "T18_T35_DACH", name: "T18 T35", construction_type: "Blacha", roof_type: "Dach", walls: "Boki" },
      ],
      error: null,
    });
    const mockEq = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSelect = vi.fn().mockImplementation((cols: string) => {
      selectCalls.push(cols);
      return { eq: mockEq };
    });
    const supabase = { from: vi.fn().mockReturnValue({ select: mockSelect }) };
    const result = await resolveTechnicalSpecFromSupabase(supabase as never, "T18_T35_DACH", logger);
    expect(result?.construction_type).toBe("Blacha");
    expect(selectCalls.length).toBeGreaterThanOrEqual(1);
    expect(selectCalls[0]).not.toContain("area_min");
    expect(selectCalls[0]).toContain("construction_type");
    expect(selectCalls[0]).toContain("variant");
  });
});

describe("getPossibleMatchValues", () => {
  it("exact match includes normalized variant", () => {
    const values = getPossibleMatchValues("PLYTA_WARSTWOWA");
    expect(values).toContain("PLYTA_WARSTWOWA");
    expect(values.length).toBeGreaterThanOrEqual(1);
  });

  it("alias match for PLYTA_WARSTWOWA includes HALA_CALOSC_Z_PLYTY_WARSTWOWEJ", () => {
    const values = getPossibleMatchValues("PLYTA_WARSTWOWA");
    expect(values.some((v) => v.includes("PLYTY") || v === "HALA_CALOSC_Z_PLYTY_WARSTWOWEJ")).toBe(true);
  });

  it("VARIANT_ALIASES has expected keys", () => {
    expect(VARIANT_ALIASES.PLYTA_WARSTWOWA).toBeDefined();
    expect(VARIANT_ALIASES.T18_T35_DACH).toBeDefined();
    expect(VARIANT_ALIASES.TERM_60_PNEU).toBeDefined();
    expect(VARIANT_ALIASES.PLANDEKA_T18).toBeDefined();
  });
});
