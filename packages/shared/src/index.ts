export { ApiClient } from "./api/client";
export type { ApiClientConfig } from "./api/client";
export type {
  MetaResponse,
  BaseResponse,
  CennikRow,
  DodatkiRow,
  StandardRow,
  LogPdfPayload,
  LogEmailPayload,
  HeartbeatPayload,
  OutboxOperationType,
  OutboxPayloadMap,
} from "./api/types";

export { syncPricingIfNewer } from "./sync/pricingSync";
export type { PricingSyncStorage, PricingSyncResult } from "./sync/pricingSync";
export { flushOutbox, generateOutboxId } from "./sync/outbox";
export type { OutboxStorage, OutboxRecord } from "./sync/outbox";
export type { FlushOutboxDeps } from "./sync/outbox";

export { calculatePrice, runPricingSelfTest } from "./pricing/pricingEngine";
export type { PricingEngineData } from "./pricing/pricingEngine";
export type { PricingInput, PricingResult, BasePriceResultType, FallbackReason } from "./pricing/types";
export { toNumber, toInt, normalizeJednostka } from "./pricing/normalize";

export { renderOfferHtml } from "./pdf/template";
export type { PdfTemplateData, OfferForPdf } from "./pdf/template";
export type {
  GeneratePdfPayload,
  GeneratePdfOffer,
  GeneratePdfPricing,
  GeneratePdfPricingBase,
  GeneratePdfAddition,
  GeneratePdfStandardInPrice,
} from "./pdf/generatePdfPayload";
export type {
  PdfTemplateConfig,
  PdfSectionVisibility,
  PdfCustomTexts,
  PdfElementPositionId,
  PdfElementPosition,
  PdfElementPositions,
} from "./pdf/templateConfig";
export {
  DEFAULT_PDF_TEMPLATE_CONFIG,
  DEFAULT_ELEMENT_POSITIONS,
  mergePdfTemplateConfig,
} from "./pdf/templateConfig";
export { generatePdf } from "./pdf/generator";
export type { PdfGeneratorOptions } from "./pdf/generator";
export type {
  PdfEditorContent,
  PdfEditorPage1Content,
  PdfEditorPage2Content,
} from "./pdf/editorContent";
export {
  DEFAULT_PDF_EDITOR_CONTENT,
  DEFAULT_PDF_EDITOR_PAGE1,
  DEFAULT_PDF_EDITOR_PAGE2,
  mergePdfEditorContent,
} from "./pdf/editorContent";

export type { SmtpCredentials, CredentialStore } from "./email/credentials";
export { CREDENTIAL_SERVICE } from "./email/credentials";
export { sendMailWithCredentials, getCyberFolksSmtpDefaults } from "./email/smtpSender";
export type { SmtpTransport, SendMailParams } from "./email/smtpSender";

export { SCHEMA_SQL } from "./db/schema";

export type { OfferCrm, OfferStatus, EmailHistoryRecord, EmailHistoryStatus, EventLogEntry, UserRole } from "./crm/types";

export {
  OFFER_STATUSES,
  USER_ROLES,
  EMAIL_HISTORY_STATUSES,
  OUTBOX_OPERATION_TYPES,
} from "./constants";
export type { OfferStatusValue, UserRoleValue, EmailHistoryStatusValue } from "./constants";

export {
  sanitizeFilePart,
  pickShorter,
  formatOfferNumberForFile,
  buildPdfFileName,
} from "./utils/pdfFileName";
export type { BuildPdfFileNameParams } from "./utils/pdfFileName";
export { escapeHtml, formatCurrency } from "./utils/format";
