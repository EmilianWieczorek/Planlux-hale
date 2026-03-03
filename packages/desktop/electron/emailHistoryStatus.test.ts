/**
 * email_history status: only queued/sent/failed. 'sending' must never be written to DB.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { allowedEmailHistoryStatus, ALLOWED_EMAIL_HISTORY_STATUSES } from "./emailService";

describe("allowedEmailHistoryStatus", () => {
  it("allowed values are only queued, sent, failed", () => {
    expect(ALLOWED_EMAIL_HISTORY_STATUSES).toEqual(["queued", "sent", "failed"]);
  });

  it("accepts queued, sent, failed as-is", () => {
    expect(allowedEmailHistoryStatus("queued")).toBe("queued");
    expect(allowedEmailHistoryStatus("sent")).toBe("sent");
    expect(allowedEmailHistoryStatus("failed")).toBe("failed");
  });

  it("never returns sending; maps sending to queued", () => {
    expect(allowedEmailHistoryStatus("sending")).toBe("queued");
    expect(allowedEmailHistoryStatus("SENDING")).toBe("queued");
  });

  it("maps unknown or empty to queued", () => {
    expect(allowedEmailHistoryStatus("")).toBe("queued");
    expect(allowedEmailHistoryStatus("x")).toBe("queued");
    expect(allowedEmailHistoryStatus(null)).toBe("queued");
  });

  it("email_history never receives status 'sending' from allowedEmailHistoryStatus", () => {
    const statusesUsedInCode = ["queued", "sent", "failed", "sending", "SENDING", "SENT", "FAILED", "QUEUED"];
    for (const s of statusesUsedInCode) {
      const normalized = allowedEmailHistoryStatus(s);
      expect(ALLOWED_EMAIL_HISTORY_STATUSES).toContain(normalized);
      expect(normalized).not.toBe("sending");
    }
  });
});
