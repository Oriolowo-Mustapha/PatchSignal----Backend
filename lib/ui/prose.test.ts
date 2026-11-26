import { describe, expect, it } from "vitest";
import { parseDiagnosisProse, parseInlineSegments } from "./prose";

describe("parseDiagnosisProse & parseInlineSegments", () => {
  it("classifies file paths, exception classes, and symbols while removing raw backticks and asterisks", () => {
    const segments = parseInlineSegments(
      "In `Program.cs`, `InvalidOperationException` fired *before* checking `Flutterwave:Mode`."
    );
    expect(segments).toEqual([
      { kind: "text", value: "In " },
      { kind: "code-file", value: "Program.cs" },
      { kind: "text", value: ", " },
      { kind: "code-error", value: "InvalidOperationException" },
      { kind: "text", value: " fired " },
      { kind: "bold", value: "before" },
      { kind: "text", value: " checking " },
      { kind: "code-symbol", value: "Flutterwave:Mode" },
      { kind: "text", value: "." },
    ]);
  });

  it("splits dense LLM diagnosis strings with inline numbered steps and bullet lists into structured blocks", () => {
    const raw =
      "The deployment failed due to two main issues: 1. `ConfigurationValidator.cs` threw `InvalidOperationException` on `Flutterwave:Mode`. 2. In `Program.cs`, `AdoptBaselineMigrationAsync` hit `EndOfStreamException` on startup. We will fix both: - In `ConfigurationValidator.cs`, handle missing values safely. - In `Program.cs`, add startup retry logic.";

    const blocks = parseDiagnosisProse(raw);
    expect(blocks[0].kind).toBe("paragraph");
    expect(blocks[1].kind).toBe("ordered");
    if (blocks[1].kind === "ordered") {
      expect(blocks[1].items).toHaveLength(2);
    }
    expect(blocks[2].kind).toBe("bullet");
    if (blocks[2].kind === "bullet") {
      expect(blocks[2].items).toHaveLength(2);
    }
  });
});
