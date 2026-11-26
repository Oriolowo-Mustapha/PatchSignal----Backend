export type ErrorContext =
  | "auth"
  | "intake"
  | "analysis"
  | "remediation"
  | "pr"
  | "workspace";

export type FormattedError = {
  title: string;
  message: string;
};

const CONTEXT_TITLES: Record<ErrorContext, string> = {
  auth: "Couldn't sign you in",
  intake: "Couldn't submit bug report",
  analysis: "Couldn't finish analysis",
  remediation: "Couldn't complete the fix",
  pr: "Couldn't create Pull Request",
  workspace: "Something went wrong",
};

const CONTEXT_FALLBACKS: Record<ErrorContext, string> = {
  auth: "We couldn't verify your details right now. Please check your information and try again.",
  intake: "We couldn't submit your bug report right now. Please check your inputs and try again.",
  analysis: "We couldn't finish analyzing this bug report right now. Please try again in a moment.",
  remediation: "We couldn't finish preparing a verified fix right now. Please try again in a moment.",
  pr: "We couldn't open the Pull Request right now. Please try again in a moment.",
  workspace: "We couldn't complete that request right now. Please try again in a moment.",
};

function capitalizeSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function looksTechnical(text: string): boolean {
  if (text.length > 140) return true;
  return (
    /\b(4\d{2}|5\d{2})\b/.test(text) ||
    /\bHTTP\s+\d+/i.test(text) ||
    /[{}]/.test(text) ||
    /\bat\s+\S+\s*\(/.test(text) ||
    /\b(Type|Reference|Syntax|Range|Prisma|Fetch|Network)?Error\b/i.test(text) ||
    /\b(P1\d{3}|P2\d{3}|ECONN\w+|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENOENT|UND_ERR\w+)\b/i.test(text) ||
    /\((INT|REPO|CLS|HYP)-\d+\)/i.test(text) ||
    /(GET|POST|PUT|DELETE)\s+\/api\//i.test(text) ||
    /\/api\//i.test(text) ||
    /\b(DATABASE_URL|JWT_SECRET|GITHUB_TOKEN|CLOUDINARY_\w+|GEMINI_\w+|GROQ_\w+)\b/.test(text) ||
    /\b(prisma|postgres|postgresql|cloudinary|gemini|groq|gemma|vitest|docker|sha256|stdout|stderr|exit\s+code|exit\s+\d+|image@digest)\b/i.test(text) ||
    /fetch failed/i.test(text) ||
    /[A-Za-z]:\\|\/src\/|\/app\//.test(text)
  );
}

/**
 * Turns backend/API error strings into plain-language, friendly copy
 * without exposing internal error codes, stack traces, or provider details.
 */
export function formatErrorMessage(
  raw: string,
  context: ErrorContext = "workspace"
): FormattedError {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      title: CONTEXT_TITLES[context],
      message: CONTEXT_FALLBACKS[context],
    };
  }

  if (/^invalid credentials$/i.test(trimmed)) {
    return {
      title: "Incorrect email or password",
      message: "Please check your email and password and try again.",
    };
  }

  if (/email already registered/i.test(trimmed)) {
    return {
      title: "Account already exists",
      message: "An account with this email already exists. Try signing in instead.",
    };
  }

  if (/too many (login|signup)?\s*attempts|rate limit|\b429\b/i.test(trimmed)) {
    return {
      title: "Too many attempts",
      message: "Please wait a few minutes and try again.",
    };
  }

  if (/valid email required/i.test(trimmed)) {
    return {
      title: "Check your email address",
      message: "Please enter a valid email address and try again.",
    };
  }

  if (/password must be (at least 8|128 characters)/i.test(trimmed)) {
    return {
      title: "Check your password",
      message: "Your password should be between 8 and 128 characters.",
    };
  }

  if (/invalid or expired token|session (revoked or )?expired|unauthorized|authentication required/i.test(trimmed)) {
    return {
      title: "Your session has ended",
      message: "Please sign in again to continue.",
    };
  }

  if (/database connection busy|temporarily busy|\b503\b|DATABASE_URL|database unreachable|P10\d{2}|P20\d{2}|prisma/i.test(trimmed)) {
    return {
      title: "Service is temporarily busy",
      message: "We're experiencing high demand right now. Please wait a moment and try again.",
    };
  }

  if (/GITHUB_WRITE_TOKEN_NEEDED|write access|personal access token|write permissions|write-scoped github token/i.test(trimmed)) {
    return {
      title: "Repository write access needed",
      message:
        "Your current GitHub connection doesn't have permission to create Pull Requests on this repository. Enter a GitHub access key with repository write access and try again.",
    };
  }

  if (/repourl and description are required/i.test(trimmed)) {
    return {
      title: "Missing required details",
      message: "Please add both a repository link and a bug description.",
    };
  }

  if (/public github\.com urls accepted|INT-1/i.test(trimmed)) {
    return {
      title: "Invalid repository link",
      message: "Please enter a valid public GitHub repository link, such as https://github.com/owner/repo.",
    };
  }

  if (/hosted demo investigates only|REPO-5/i.test(trimmed)) {
    return {
      title: "Repository isn't available here",
      message: "This repository isn't enabled for investigation in this workspace.",
    };
  }

  if (/max\s+\d+\s+screenshots/i.test(trimmed)) {
    return {
      title: "Too many screenshots",
      message: "You can attach up to 3 screenshots per bug report.",
    };
  }

  if (/only png\/jpeg accepted/i.test(trimmed)) {
    return {
      title: "Unsupported image format",
      message: "Only PNG and JPEG screenshots are supported.",
    };
  }

  if (/exceeds 5\s*mb/i.test(trimmed)) {
    return {
      title: "Screenshot is too large",
      message: "Please choose an image smaller than 5 MB.",
    };
  }

  if (/cloudinary/i.test(trimmed)) {
    return {
      title: "Couldn't upload screenshot",
      message: "We couldn't save your screenshot right now. Please try again or submit without it.",
    };
  }

  if (/CLS-4|ecosystem is unsupported|cannot generate vitest hypothesis/i.test(trimmed)) {
    return {
      title: "Unsupported project type",
      message: "We couldn't find supported project files to verify automatically in this repository.",
    };
  }

  if (/no candidate test content|hypotheses first/i.test(trimmed)) {
    return {
      title: "Verification test needed first",
      message: "Generate a hypothesis and test before running verification.",
    };
  }

  if (/image@digest|pinned image/i.test(trimmed)) {
    return {
      title: "Build reference required",
      message: "Please enter a target build reference before starting this run.",
    };
  }

  if (/approved:\s*true|explicit user permission/i.test(trimmed)) {
    return {
      title: "Approval required",
      message: "Please review and confirm the Pull Request details before continuing.",
    };
  }

  if (/no verified code fix patches/i.test(trimmed)) {
    return {
      title: "No verified fix ready yet",
      message: "Run the automated fix and verification step before creating a Pull Request.",
    };
  }

  if (/no open pull request|no pull request available/i.test(trimmed)) {
    return {
      title: "No Pull Request available",
      message: "Create a Pull Request for this fix first before checking or updating it.",
    };
  }

  if (/no failing ci checks detected/i.test(trimmed)) {
    return {
      title: "No failing checks found",
      message: "There are no failing checks to repair on this Pull Request right now.",
    };
  }

  if (/HTTP 413|request too large|tokens per minute|reduce your message size/i.test(trimmed)) {
    return {
      title: "Report is too large to process",
      message:
        "There was too much text to analyze at once. Add a shorter note focusing on the main issue and try again.",
    };
  }

  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|timed out|aborted/i.test(trimmed)) {
    return {
      title: "Connection interrupted",
      message:
        "We lost connection while working on your request. Check your internet connection and try again.",
    };
  }

  if (
    /(groq|gemini) fix generation failed|could not generate a fix|hypothesis generation failed|analysis queue unavailable|automated remediation failed/i.test(
      trimmed
    )
  ) {
    return {
      title: "Couldn't complete the automated step",
      message: "We hit a snag while processing this request. Please try again in a moment.",
    };
  }

  if (/not found|\b404\b/i.test(trimmed) && !/repository/i.test(trimmed)) {
    return {
      title: "Couldn't find that item",
      message: "This item may have been removed or is no longer available.",
    };
  }

  if (looksTechnical(trimmed)) {
    return {
      title: CONTEXT_TITLES[context],
      message: CONTEXT_FALLBACKS[context],
    };
  }

  const sanitized = trimmed.replace(/\s*\((?:INT|REPO|CLS|HYP)-\d+\)/gi, "").trim();
  const capitalized = capitalizeSentence(sanitized);
  if (!capitalized) {
    return {
      title: CONTEXT_TITLES[context],
      message: CONTEXT_FALLBACKS[context],
    };
  }

  const title = CONTEXT_TITLES[context];
  return {
    title: title.toLowerCase() === capitalized.toLowerCase() ? "Action couldn't be completed" : title,
    message: capitalized.endsWith(".") ? capitalized : `${capitalized}.`,
  };
}
