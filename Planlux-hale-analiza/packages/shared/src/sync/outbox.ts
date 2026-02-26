/**
 * Kolejka outbox: operacje SEND_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT.
 * Flush w kolejności z retry/backoff; idempotency po stronie backendu (id).
 */

import type { ApiClient } from "../api/client";
import type { OutboxOperationType, OutboxPayloadMap } from "../api/types";

export interface OutboxRecord<T extends OutboxOperationType = OutboxOperationType> {
  id: string;
  operation_type: T;
  payload_json: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface OutboxStorage {
  getPending(): Promise<OutboxRecord[]>;
  markProcessed(id: string): void;
  markFailed(id: string, error: string, incrementRetry: boolean): void;
}

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FlushOutboxDeps {
  api: ApiClient;
  storage: OutboxStorage;
  sendEmail?: (payload: OutboxPayloadMap["SEND_EMAIL"]) => Promise<void>;
  offerSync?: (payload: OutboxPayloadMap["OFFER_SYNC"]) => Promise<void>;
  isOnline: () => boolean;
}

/**
 * Przetwarza outbox w kolejności created_at.
 * HEARTBEAT → LOG_PDF → SEND_EMAIL (wywołuje sendEmail) → LOG_EMAIL.
 * Dla SEND_EMAIL wymaga inject sendEmail; bez niego pomija i zostawia w kolejce.
 */
export async function flushOutbox(deps: FlushOutboxDeps): Promise<{ processed: number; failed: number }> {
  const pending = await deps.storage.getPending();
  let processed = 0;
  let failed = 0;

  for (const record of pending) {
    if (record.retry_count >= record.max_retries) {
      deps.storage.markFailed(record.id, "Max retries exceeded", false);
      failed++;
      continue;
    }

    try {
      const payload = JSON.parse(record.payload_json) as OutboxPayloadMap[OutboxOperationType];

      switch (record.operation_type) {
        case "HEARTBEAT":
          await deps.api.heartbeat(payload as OutboxPayloadMap["HEARTBEAT"]);
          break;
        case "LOG_PDF":
          await deps.api.logPdf(payload as OutboxPayloadMap["LOG_PDF"]);
          break;
        case "LOG_EMAIL":
          await deps.api.logEmail(payload as OutboxPayloadMap["LOG_EMAIL"]);
          break;
        case "SEND_EMAIL":
          if (deps.sendEmail && deps.isOnline()) {
            await deps.sendEmail(payload as OutboxPayloadMap["SEND_EMAIL"]);
          } else {
            continue;
          }
          break;
        case "OFFER_SYNC":
          if (deps.offerSync && deps.isOnline()) {
            await deps.offerSync(payload as OutboxPayloadMap["OFFER_SYNC"]);
          } else {
            continue;
          }
          break;
        default:
          deps.storage.markFailed(record.id, `Unknown operation: ${record.operation_type}`, true);
          failed++;
          continue;
      }

      deps.storage.markProcessed(record.id);
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const backoff = BACKOFF_MS[Math.min(record.retry_count, BACKOFF_MS.length - 1)];
      deps.storage.markFailed(record.id, msg, true);
      failed++;
      await delay(backoff);
    }
  }

  return { processed, failed };
}

export function generateOutboxId(): string {
  return `out-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
