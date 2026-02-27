/**
 * Tests for emailService: enqueueEmail, backoff.
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";
import { enqueueEmail } from "./emailService";

describe("emailService", () => {
  it("enqueueEmail returns id and calls db.prepare().run with queued status", () => {
    const run = vi.fn();
    const db = { prepare: vi.fn(() => ({ run })) } as unknown as Parameters<typeof enqueueEmail>[0];
    const logger = { info: vi.fn() };
    const id = enqueueEmail(db, {
      to: "user@example.com",
      subject: "Test",
      text: "Body",
    }, logger);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO email_outbox.*queued/)
    );
    expect(run).toHaveBeenCalled();
  });

  it("enqueueEmail passes optional fields", () => {
    const run = vi.fn();
    const db = { prepare: vi.fn(() => ({ run })) } as unknown as Parameters<typeof enqueueEmail>[0];
    const logger = { info: vi.fn() };
    enqueueEmail(db, {
      to: "a@b.pl",
      subject: "Sub",
      text: "T",
      html: "<p>T</p>",
      relatedOfferId: "off-1",
      accountId: "acc-1",
    }, logger);
    expect(run).toHaveBeenCalled();
    const args = run.mock.calls[0];
    expect(args).toContain("a@b.pl");
    expect(args).toContain("off-1");
    expect(args).toContain("acc-1");
  });
});
