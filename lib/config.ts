export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  gemmaPrimary: process.env.GEMMA_PRIMARY ?? "gemma-4-31b-it",
  gemmaFallback: process.env.GEMMA_FALLBACK ?? "gemini-3.5-flash-lite",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  allowlist: (process.env.ALLOWLIST_REPOS ?? "patchsignal/demo-signup")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  runnerToken: process.env.RUNNER_TOKEN ?? "",
  runnerUrl: process.env.RUNNER_URL ?? "http://localhost:5001",
  controlSha: process.env.CONTROL_SHA ?? "",
  modelProvider: (process.env.MODEL_PROVIDER ?? "gemini") as "gemini" | "groq",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "",
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
    folder: process.env.CLOUDINARY_FOLDER ?? "patchsignal",
  },
  promptVersion: "v0.1",
  maxScreenshots: 3,
  maxScreenshotBytes: 5 * 1024 * 1024,
} as const;

export function isAllowlisted(owner: string, repo: string): boolean {
  // ALLOWLIST_REPOS=* opens intake to any public github.com repo.
  // Local testing only — hosted demo stays allowlisted (abuse + model cost).
  if (config.allowlist.includes("*")) return true;
  return config.allowlist.includes(`${owner.toLowerCase()}/${repo.toLowerCase()}`);
}
