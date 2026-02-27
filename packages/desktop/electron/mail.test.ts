/**
 * Tests for generic SMTP mail helper (mail.ts).
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("nodemailer", () => {
  const sendMail = vi.fn().mockResolvedValue({});
  const createTransport = vi.fn(() => ({ sendMail }));
  return {
    default: { createTransport, sendMail },
    createTransport,
  };
});

describe("mail.sendEmail", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    process.env.PLANLUX_SMTP_HOST = "smtp.example.com";
    process.env.PLANLUX_SMTP_PORT = "465";
    process.env.PLANLUX_SMTP_SECURE = "true";
    process.env.PLANLUX_SMTP_USER = "user@example.com";
    process.env.PLANLUX_SMTP_PASS = "secret";
    process.env.PLANLUX_SMTP_FROM = "No Reply <noreply@example.com>";
  });

  it("sends email with valid config and input", async () => {
    const { sendEmail } = await import("./mail");
    const nodemailer = await import("nodemailer");
    const mocked = (nodemailer.default as unknown as { createTransport: ReturnType<typeof vi.fn> });

    await sendEmail({
      to: "client@example.com",
      subject: "Test subject",
      text: "Hello world",
    });

    expect(mocked.createTransport).toHaveBeenCalledTimes(1);
    const transporter = mocked.createTransport.mock.results[0].value as { sendMail: ReturnType<typeof vi.fn> };
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    const args = transporter.sendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(args.to).toBe("client@example.com");
    expect(args.subject).toBe("Test subject");
    expect(args.text).toBe("Hello world");
    expect(args.from).toBe("No Reply <noreply@example.com>");
  });

  it("throws for invalid recipient email", async () => {
    const { sendEmail } = await import("./mail");
    await expect(
      sendEmail({ to: "not-an-email", subject: "x", text: "body" })
    ).rejects.toThrow(/Invalid recipient email/i);
  });

  it("throws when required SMTP env vars are missing", async () => {
    delete process.env.PLANLUX_SMTP_HOST;
    delete process.env.SMTP_HOST;
    const { sendEmail } = await import("./mail");
    await expect(
      sendEmail({ to: "client@example.com", subject: "x", text: "body" })
    ).rejects.toThrow(/SMTP configuration missing/i);
  });
});

