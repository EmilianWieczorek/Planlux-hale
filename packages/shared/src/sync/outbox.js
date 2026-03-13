"use strict";
/**
 * Kolejka outbox: operacje SEND_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT.
 * Flush w kolejności z retry/backoff; idempotency po stronie backendu (id).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushOutbox = flushOutbox;
exports.generateOutboxId = generateOutboxId;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Przetwarza outbox w kolejności created_at.
 * HEARTBEAT → LOG_PDF → SEND_EMAIL (wywołuje sendEmail) → LOG_EMAIL.
 * Dla SEND_EMAIL wymaga inject sendEmail; bez niego pomija i zostawia w kolejce.
 */
async function flushOutbox(deps) {
    const pending = await deps.storage.getPending();
    let processed = 0;
    let failed = 0;
    let firstError;
    for (const record of pending) {
        if (record.retry_count >= record.max_retries) {
            deps.storage.markFailed(record.id, "Max retries exceeded", false);
            failed++;
            continue;
        }
        try {
            const payload = JSON.parse(record.payload_json);
            switch (record.operation_type) {
                case "HEARTBEAT":
                    await deps.api.heartbeat(payload);
                    break;
                case "LOG_PDF":
                    await deps.api.logPdf(payload);
                    break;
                case "LOG_EMAIL":
                    await deps.api.logEmail(payload);
                    break;
                case "SEND_EMAIL":
                    if (deps.sendEmail && deps.isOnline()) {
                        await deps.sendEmail(payload);
                    }
                    else {
                        continue;
                    }
                    break;
                case "SEND_GENERIC_EMAIL":
                    if (deps.sendGenericEmail && deps.isOnline()) {
                        await deps.sendGenericEmail(payload);
                    }
                    else {
                        continue;
                    }
                    break;
                case "OFFER_SYNC":
                    if (deps.offerSync && deps.isOnline()) {
                        await deps.offerSync(payload);
                    }
                    else {
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const errWithCode = err;
            if (!firstError) {
                firstError = {
                    code: errWithCode.code,
                    message: msg,
                    details: errWithCode.details,
                    operationType: record.operation_type,
                };
            }
            const backoff = BACKOFF_MS[Math.min(record.retry_count, BACKOFF_MS.length - 1)];
            deps.storage.markFailed(record.id, msg, true);
            failed++;
            await delay(backoff);
        }
    }
    return { processed, failed, firstError };
}
function generateOutboxId() {
    return `out-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
