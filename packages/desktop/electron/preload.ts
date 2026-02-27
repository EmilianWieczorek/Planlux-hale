/**
 * Preload – bridge do renderera. Nie eksponuje ipcRenderer; tylko whitelist kanałów.
 */

const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_CHANNELS = new Set([
  "planlux:login",
  "planlux:logout",
  "planlux:endSession",
  "planlux:getPricingCache",
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
  "planlux:createOffer",
  "planlux:getNextOfferNumber",
  "planlux:loadOfferDraft",
  "planlux:saveOfferDraft",
  "planlux:clearOfferDraft",
  "planlux:getDashboardStats",
  "planlux:getOffersCrm",
  "planlux:findDuplicateOffers",
  "planlux:markOfferRealized",
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
  "base:sync",
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
  onUpdateAvailable: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on("planlux:update-available", (_: unknown, info: { version: string }) => cb(info));
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on("planlux:update-downloaded", () => cb());
  },
  downloadUpdate: () => safeInvoke("planlux:downloadUpdate"),
  quitAndInstall: () => safeInvoke("planlux:quitAndInstall"),
};

const api = {
  syncBase: () => safeInvoke("base:sync"),
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
