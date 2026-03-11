/**
 * Preload – bridge do renderera. Nie eksponuje ipcRenderer; tylko whitelist kanałów.
 */

const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_CHANNELS = new Set([
  "login",
  "planlux:login",
  "planlux:syncUsers",
  "planlux:logout",
  "planlux:session",
  "planlux:auth:debugCurrentUser",
  "planlux:auth:repairCurrentUserRole",
  "planlux:changePassword",
  "planlux:endSession",
  "planlux:getPricingCache",
  "planlux:getConfigSyncStatus",
  "planlux:diagnostics",
  "planlux:logToFile",
  "planlux:getDiagnosticsPanelData",
  "planlux:openLogsFolder",
  "planlux:getLogPath",
  "planlux:testSupabaseConnection",
  "planlux:testEndToEnd",
  "planlux:syncPricing",
  "planlux:calculatePrice",
  "planlux:seedAdmin",
  "planlux:enqueueHeartbeat",
  "planlux:getActivity",
  "planlux:getUsers",
  "planlux:createUser",
  "planlux:updateUser",
  "planlux:disableUser",
  "planlux:getOffers",
  "planlux:saveOffer",
  "planlux:saveOfferToSupabase",
  "planlux:createOffer",
  "planlux:getNextOfferNumber",
  "planlux:loadOfferDraft",
  "planlux:saveOfferDraft",
  "planlux:clearOfferDraft",
  "planlux:getDashboardStats",
  "planlux:getOffersCrm",
  "planlux:findDuplicateOffers",
  "planlux:markOfferRealized",
  "planlux:deleteOffer",
  "planlux:getOfferDetails",
  "planlux:getOfferAudit",
  "planlux:getEmailHistoryForOffer",
  "planlux:getPdfsForOffer",
  "planlux:sendOfferEmail",
  "planlux:sendEmail",
  "planlux:loadOfferForEdit",
  "planlux:syncTempOfferNumbers",
  "planlux:replaceOfferNumber",
  "planlux:getPdfs",
  "planlux:getEmails",
  "planlux:getOutboxCount",
  "planlux:isOnline",
  "planlux:getConfig",
  "planlux:checkInternet",
  "planlux:smtp:listAccounts",
  "planlux:smtp:upsertAccount",
  "planlux:smtp:setDefaultAccount",
  "planlux:smtp:testAccount",
  "planlux:smtp:deleteAccount",
  "planlux:smtp:isKeytarAvailable",
  "planlux:smtp:getForCurrentUser",
  "planlux:smtp:upsertForUser",
  "planlux:smtp:testForUser",
  "planlux:settings:getEmailSettings",
  "planlux:settings:updateEmailSettings",
  "planlux:email:send",
  "planlux:email:getOfferEmailPreview",
  "planlux:email:sendOfferEmail",
  "planlux:pdf:ensureOfferPdf",
  "planlux:attachments:pickFiles",
  "planlux:email:outboxList",
  "planlux:email:retryNow",
  "planlux:email:historyList",
  "planlux:debugEmailTables",
  "pdf:generate",
  "planlux:generatePdf",
  "planlux:generatePdfPreview",
  "pdf:preview",
  "planlux:loadPdfTemplateConfig",
  "planlux:savePdfTemplateConfig",
  "planlux:resetPdfTemplateConfig",
  "planlux:loadPdfEditorContent",
  "planlux:savePdfEditorContent",
  "planlux:getPdfDebugInfo",
  "planlux:getPdfPreviewHtml",
  "planlux:downloadUpdate",
  "planlux:quitAndInstall",
  "planlux:app:getVersion",
  "planlux:app:openExternal",
  "planlux:app:getUpdatesUrl",
  "planlux:updates:getCurrentVersion",
  "planlux:updates:openExternal",
  "planlux:updates:getUpdatesUrl",
  "planlux:updates:check",
  "planlux:updates:getState",
  "planlux:updates:download",
  "planlux:updates:install",
  "planlux:updates:dismiss",
  "shell:openPath",
  "shell:showItemInFolder",
]);

function safeInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (!ALLOWED_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`Channel not allowed: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

const planlux = {
  platform: "desktop" as const,
  version: process.env.npm_package_version ?? "1.0.0",
  invoke: safeInvoke,
  app: {
    getVersion: () => safeInvoke("planlux:app:getVersion"),
    openExternal: (url: string) => safeInvoke("planlux:app:openExternal", url),
    getUpdatesUrl: () => safeInvoke("planlux:app:getUpdatesUrl"),
  },
  updates: {
    getCurrentVersion: () => safeInvoke("planlux:updates:getCurrentVersion"),
    openExternal: (url: string) => safeInvoke("planlux:updates:openExternal", url),
    getUpdatesUrl: () => safeInvoke("planlux:updates:getUpdatesUrl"),
    check: () => safeInvoke("planlux:updates:check"),
    getState: () => safeInvoke("planlux:updates:getState"),
    download: () => safeInvoke("planlux:updates:download"),
    install: () => safeInvoke("planlux:updates:install"),
    dismiss: () => safeInvoke("planlux:updates:dismiss"),
  },
  /** Custom updater events (Supabase-based; use when planlux.updates.check is used). */
  onUpdateCheckingCustom: (cb: () => void) => {
    ipcRenderer.on("planlux:update:checking", () => cb());
  },
  onUpdateAvailableCustom: (cb: (info: { release: { version: string; title: string; changelog: string; download_url: string; sha256: string; mandatory: boolean }; version: string }) => void) => {
    ipcRenderer.on("planlux:update:available", (_: unknown, info: { release: unknown; version: string }) => cb(info as { release: { version: string; title: string; changelog: string; download_url: string; sha256: string; mandatory: boolean }; version: string }));
  },
  onUpdateProgress: (cb: (p: { percent: number; bytesPerSecond: number | null; transferred: number; total: number | null }) => void) => {
    ipcRenderer.on("planlux:update:progress", (_: unknown, p: { percent: number; bytesPerSecond: number | null; transferred: number; total: number | null }) => cb(p));
  },
  onUpdateDownloadedCustom: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on("planlux:update:downloaded", (_: unknown, info: { version: string }) => cb(info));
  },
  onUpdateErrorCustom: (cb: (e: { message: string }) => void) => {
    ipcRenderer.on("planlux:update:error", (_: unknown, e: { message: string }) => cb(e));
  },
  onUpdateAvailable: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on("planlux:update-available", (_: unknown, info: { version: string }) => cb(info));
  },
  onUpdateChecking: (cb: () => void) => {
    ipcRenderer.on("planlux:update-checking", () => cb());
  },
  onUpdateNotAvailable: (cb: (info: { version?: string | null }) => void) => {
    ipcRenderer.on("planlux:update-not-available", (_: unknown, info: { version?: string | null }) => cb(info));
  },
  onUpdateDownloadProgress: (cb: (p: { percent: number | null; bytesPerSecond: number | null; transferred: number | null; total: number | null }) => void) => {
    ipcRenderer.on("planlux:update-download-progress", (_: unknown, p: { percent: number | null; bytesPerSecond: number | null; transferred: number | null; total: number | null }) => cb(p));
  },
  onUpdateError: (cb: (e: { message: string }) => void) => {
    ipcRenderer.on("planlux:update-error", (_: unknown, e: { message: string }) => cb(e));
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on("planlux:update-downloaded", () => cb());
  },
  downloadUpdate: () => safeInvoke("planlux:downloadUpdate"),
  quitAndInstall: () => safeInvoke("planlux:quitAndInstall"),
};

const api = {
  generatePdf: (payload: unknown) => safeInvoke("pdf:generate", payload),
  pdfGenerate: (offerData: unknown) => safeInvoke("pdf:generate", offerData),
  sendEmail: (data: unknown) => safeInvoke("planlux:sendEmail", data),
  checkInternet: () => safeInvoke("planlux:checkInternet"),
  email: {
    checkInternet: () => safeInvoke("planlux:checkInternet"),
    getSettings: () => safeInvoke("planlux:settings:getEmailSettings"),
    updateSettings: (payload: unknown) => safeInvoke("planlux:settings:updateEmailSettings", payload),
    sendOfferEmail: (payload: unknown) => safeInvoke("planlux:email:sendOfferEmail", payload),
    outboxList: (filter?: { status?: string }) => safeInvoke("planlux:email:outboxList", filter ?? {}),
    retryNow: (outboxId: string) => safeInvoke("planlux:email:retryNow", outboxId),
    historyForOffer: (offerId: string) => safeInvoke("planlux:getEmailHistoryForOffer", offerId),
    getOfferEmailPreview: (offerId: string) => safeInvoke("planlux:email:getOfferEmailPreview", offerId),
    debugEmailTables: () => safeInvoke("planlux:debugEmailTables"),
  },
  smtp: {
    listAccounts: () => safeInvoke("planlux:smtp:listAccounts"),
    upsertAccount: (data: unknown) => safeInvoke("planlux:smtp:upsertAccount", data),
    upsertForUser: (payload: unknown) => safeInvoke("planlux:smtp:upsertForUser", payload),
    testForUser: (userId?: string) => safeInvoke("planlux:smtp:testForUser", userId),
    testAccount: (accountId: string) => safeInvoke("planlux:smtp:testAccount", accountId),
    getForCurrentUser: () => safeInvoke("planlux:smtp:getForCurrentUser"),
  },
  smtpListAccounts: () => safeInvoke("planlux:smtp:listAccounts"),
  smtpUpsertAccount: (payload: unknown) => safeInvoke("planlux:smtp:upsertAccount", payload),
  smtpSetDefaultAccount: (accountId: string) => safeInvoke("planlux:smtp:setDefaultAccount", accountId),
  smtpTestAccount: (accountId: string) => safeInvoke("planlux:smtp:testAccount", accountId),
  smtpDeleteAccount: (accountId: string) => safeInvoke("planlux:smtp:deleteAccount", accountId),
  smtpIsKeytarAvailable: () => safeInvoke("planlux:smtp:isKeytarAvailable"),
  smtpGetForCurrentUser: () => safeInvoke("planlux:smtp:getForCurrentUser"),
  smtpUpsertForUser: (payload: unknown) => safeInvoke("planlux:smtp:upsertForUser", payload),
  smtpTestForUser: (userId?: string) => safeInvoke("planlux:smtp:testForUser", userId),
  getEmailSettings: () => safeInvoke("planlux:settings:getEmailSettings"),
  updateEmailSettings: (payload: unknown) => safeInvoke("planlux:settings:updateEmailSettings", payload),
  emailSend: (payload: unknown) => safeInvoke("planlux:email:send", payload),
  emailGetOfferEmailPreview: (offerId: string) => safeInvoke("planlux:email:getOfferEmailPreview", offerId),
  emailSendOfferEmail: (payload: unknown) => safeInvoke("planlux:email:sendOfferEmail", payload),
  pdfEnsureOfferPdf: (offerId: string) => safeInvoke("planlux:pdf:ensureOfferPdf", offerId),
  attachmentsPickFiles: () => safeInvoke("planlux:attachments:pickFiles"),
  emailOutboxList: (filter?: { status?: string }) => safeInvoke("planlux:email:outboxList", filter ?? {}),
  emailRetryNow: (outboxId: string) => safeInvoke("planlux:email:retryNow", outboxId),
  emailHistoryList: (limit?: number) => safeInvoke("planlux:email:historyList", limit),
};

contextBridge.exposeInMainWorld("planlux", planlux);
contextBridge.exposeInMainWorld("api", api);

/** DEV ONLY: auth role debug – inspect session/local/Supabase role and run repair. Not exposed in production. */
const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
if (isDev) {
  contextBridge.exposeInMainWorld("__planluxAuthDebug", {
    debugCurrentUser: () => safeInvoke("planlux:auth:debugCurrentUser"),
    repairCurrentUserRole: () => safeInvoke("planlux:auth:repairCurrentUserRole"),
  });
}
