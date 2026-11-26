import { describe, expect, it } from "vitest";
import { formatErrorMessage } from "./error-messages";

describe("formatErrorMessage", () => {
  it("formats invalid credentials into plain, actionable guidance", () => {
    const res = formatErrorMessage("invalid credentials", "auth");
    expect(res.title).toBe("Incorrect email or password");
    expect(res.message).toBe("Please check your email and password and try again.");
    expect("details" in res).toBe(false);
  });

  it("formats duplicate email registration clearly", () => {
    const res = formatErrorMessage("email already registered", "auth");
    expect(res.title).toBe("Account already exists");
    expect(res.message).toMatch(/already exists/i);
  });

  it("translates HTTP 413 provider JSON without leaking HTTP codes, provider names, or JSON", () => {
    const raw =
      'Groq fix generation failed: HTTP 413 {"error":{"message":"Request too large for model Limit 8000, Requested 16165"}}';
    const res = formatErrorMessage(raw, "remediation");
    expect(res.title).toBe("Report is too large to process");
    expect(res.message).toMatch(/too much text to analyze/i);
    expect(res.message).not.toMatch(/413|Groq|\{|\}|Limit 8000/i);
  });

  it("formats transient database busy and Prisma errors cleanly without internal codes", () => {
    const busy = formatErrorMessage("Database connection busy. Please retry in a moment.", "workspace");
    expect(busy.title).toBe("Service is temporarily busy");
    expect(busy.message).toMatch(/wait a moment/i);

    const prismaErr = formatErrorMessage(
      "Invalid `prisma.session.findUnique()` invocation: Error P1017 SERVER_CLOSED DATABASE_URL",
      "workspace"
    );
    expect(prismaErr.title).toBe("Service is temporarily busy");
    expect(prismaErr.message).not.toMatch(/prisma|P1017|DATABASE_URL|findUnique/i);
  });

  it("formats transient network/fetch failures without leaking model names or fetch errors", () => {
    const raw =
      "Could not generate a fix. Gemini fix generation failed: gemini-3.5-flash-lite: fetch failed | fetch failed";
    const res = formatErrorMessage(raw, "remediation");
    expect(res.title).toBe("Connection interrupted");
    expect(res.message).toMatch(/internet connection/i);
    expect(res.message).not.toMatch(/Gemini|fetch failed|flash-lite/i);
  });

  it("translates internal rule codes, Cloudinary errors, and stack traces cleanly", () => {
    const urlRes = formatErrorMessage("Only public github.com URLs accepted (INT-1)", "intake");
    expect(urlRes.title).toBe("Invalid repository link");
    expect(urlRes.message).not.toMatch(/INT-1/i);

    const ecoRes = formatErrorMessage(
      "Repository ecosystem is unsupported (CLS-4); cannot generate Vitest hypothesis.",
      "analysis"
    );
    expect(ecoRes.title).toBe("Unsupported project type");
    expect(ecoRes.message).not.toMatch(/CLS-4|Vitest/i);

    const cloudRes = formatErrorMessage("Cloudinary upload failed: connect ETIMEDOUT", "intake");
    expect(cloudRes.title).toBe("Couldn't upload screenshot");
    expect(cloudRes.message).not.toMatch(/Cloudinary|ETIMEDOUT/i);

    const stackRes = formatErrorMessage(
      "TypeError: Cannot read properties of undefined (reading 'id') at GET (/app/api/auth/me/route.ts:7:16)",
      "workspace"
    );
    expect(stackRes.title).toBe("Something went wrong");
    expect(stackRes.message).toMatch(/Please try again/i);
    expect(stackRes.message).not.toMatch(/TypeError|route\.ts/i);
  });

  it("preserves benign short messages cleanly while removing details", () => {
    const res = formatErrorMessage("repository not found", "workspace");
    expect(res.title).toBe("Something went wrong");
    expect(res.message).toBe("Repository not found.");
    expect("details" in res).toBe(false);
  });
});
