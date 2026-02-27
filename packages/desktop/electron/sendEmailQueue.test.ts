/**
 * Tests for planlux:sendEmail offline queue and flushOutbox SEND_GENERIC_EMAIL.
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushOutbox } from "@planlux/shared";

describe("sendEmail queue and flush", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("flushOutbox calls sendGenericEmail when online and SEND_GENERIC_EMAIL pending", async () => {
    const sendGenericEmail = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getPending: vi.fn().mockResolvedValue([
        {
          id: "out-1",
          operation_type: "SEND_GENERIC_EMAIL",
          payload_json: JSON.stringify({
            to: "user@example.com",
            subject: "Test",
            text: "Body",
          }),
          retry_count: 0,
          max_retries: 5,
          last_error: null,
          created_at: new Date().toISOString(),
          processed_at: null,
        },
      ]),
      markProcessed: vi.fn(),
      markFailed: vi.fn(),
    };
    const api = {
      heartbeat: vi.fn().mockResolvedValue(undefined),
      logPdf: vi.fn().mockResolvedValue(undefined),
      logEmail: vi.fn().mockResolvedValue(undefined),
    };

    const result = await flushOutbox({
      api,
      storage,
      isOnline: () => true,
      sendGenericEmail,
    });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(sendGenericEmail).toHaveBeenCalledTimes(1);
    expect(sendGenericEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "Test",
      text: "Body",
    });
    expect(storage.markProcessed).toHaveBeenCalledWith("out-1");
  });

  it("flushOutbox does not call sendGenericEmail when offline", async () => {
    const sendGenericEmail = vi.fn();
    const storage = {
      getPending: vi.fn().mockResolvedValue([
        {
          id: "out-2",
          operation_type: "SEND_GENERIC_EMAIL",
          payload_json: JSON.stringify({ to: "a@b.com", subject: "S", text: "T" }),
          retry_count: 0,
          max_retries: 5,
          last_error: null,
          created_at: new Date().toISOString(),
          processed_at: null,
        },
      ]),
      markProcessed: vi.fn(),
      markFailed: vi.fn(),
    };
    const api = {
      heartbeat: vi.fn().mockResolvedValue(undefined),
      logPdf: vi.fn().mockResolvedValue(undefined),
      logEmail: vi.fn().mockResolvedValue(undefined),
    };

    await flushOutbox({
      api,
      storage,
      isOnline: () => false,
      sendGenericEmail,
    });

    expect(sendGenericEmail).not.toHaveBeenCalled();
    expect(storage.markProcessed).not.toHaveBeenCalled();
  });
});
