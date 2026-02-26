/**
 * Warstwa adaptera do zapisu/odczytu PdfTemplateConfig.
 * Etap 1: plik JSON w userData. Później: jeden punkt integracji → SQLite (offers.pdf_template_config_json lub osobna tabela).
 */

import path from "path";
import fs from "fs";
import type { PdfTemplateConfig } from "@planlux/shared";
import { mergePdfTemplateConfig } from "@planlux/shared";

const CONFIG_FILENAME = "pdf-template-config.json";

export interface PdfTemplateConfigStore {
  /** Zwraca zapisaną konfigurację lub null, gdy brak. */
  load(offerIdOrDraftId: string): Promise<PdfTemplateConfig | null>;
  /** Zapisuje konfigurację (lekki, nie blokuje UI). */
  save(offerIdOrDraftId: string, config: PdfTemplateConfig): Promise<void>;
  /** Usuwa zapis dla danego klucza. */
  reset(offerIdOrDraftId: string): Promise<void>;
}

type ConfigMap = Record<string, Partial<PdfTemplateConfig>>;

/**
 * Implementacja etap 1: jeden plik JSON w katalogu userData.
 * Klucz: offerId lub draftId (np. "editor-draft").
 *
 * TODO SQLite (jeden punkt integracji – podmiana bez zmian w UI):
 * - Zaimplementować PdfTemplateConfigStore przy użyciu getDb():
 *   np. tabela offer_pdf_template_config (offer_id TEXT PRIMARY KEY, config_json TEXT, updated_at TEXT)
 *   lub kolumna offers.pdf_template_config_json.
 * - W ipc.ts: zamiast createFilePdfTemplateConfigStore(...) przekazać createSqlitePdfTemplateConfigStore(getDb)
 *   i rejestrować handlery planlux:load/save/resetPdfTemplateConfig tak jak teraz.
 */
export function createFilePdfTemplateConfigStore(userDataPath: string): PdfTemplateConfigStore {
  const filePath = path.join(userDataPath, CONFIG_FILENAME);

  function readMap(): ConfigMap {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw) as ConfigMap;
        return typeof data === "object" && data !== null ? data : {};
      }
    } catch (_) {
      // uszkodzony plik lub brak – zwracamy pusty obiekt
    }
    return {};
  }

  function writeMap(map: ConfigMap): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(map, null, 0), "utf-8");
    } catch (e) {
      throw e;
    }
  }

  return {
    async load(offerIdOrDraftId: string): Promise<PdfTemplateConfig | null> {
      const map = readMap();
      const raw = map[offerIdOrDraftId];
      if (raw == null || typeof raw !== "object") return null;
      return mergePdfTemplateConfig(raw as Partial<PdfTemplateConfig>);
    },

    async save(offerIdOrDraftId: string, config: PdfTemplateConfig): Promise<void> {
      const map = readMap();
      map[offerIdOrDraftId] = { ...config };
      writeMap(map);
    },

    async reset(offerIdOrDraftId: string): Promise<void> {
      const map = readMap();
      if (!(offerIdOrDraftId in map)) return;
      delete map[offerIdOrDraftId];
      writeMap(map);
    },
  };
}
