"use strict";
/**
 * Synchronizacja bazy cennika: GET meta → porównanie version → GET base → zapis lokalny.
 * Działa offline (brak zapisu przy braku połączenia).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncPricingIfNewer = syncPricingIfNewer;
async function syncPricingIfNewer(api, storage) {
    const localVersion = storage.getLocalVersion();
    let meta;
    try {
        meta = await api.getMeta();
    }
    catch (e) {
        return {
            updated: false,
            version: localVersion,
            error: e instanceof Error ? e.message : "Network error",
        };
    }
    const remoteVersion = meta.meta?.version ?? 0;
    if (remoteVersion <= localVersion) {
        return { updated: false, version: localVersion };
    }
    let full;
    try {
        full = await api.getBase();
    }
    catch (e) {
        return {
            updated: false,
            version: localVersion,
            error: e instanceof Error ? e.message : "Failed to fetch base",
        };
    }
    if (!full.ok || !full.cennik) {
        return {
            updated: false,
            version: localVersion,
            error: "Invalid base response",
        };
    }
    storage.savePricingSnapshot(full.meta.version, full.meta.lastUpdated, full);
    return {
        updated: true,
        version: full.meta.version,
    };
}
