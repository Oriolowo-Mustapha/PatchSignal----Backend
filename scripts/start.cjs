#!/usr/bin/env node
// Production entrypoint: resolves DIRECT_URL when the host (e.g. Render) only
// provides DATABASE_URL, applies pending migrations, then starts Next.js.
const { spawnSync, spawn } = require("node:child_process");

function deriveDirectUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    // Supabase transaction pooler (6543) -> session pooler (5432), which
    // supports the advisory locks and prepared statements migrations need.
    if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") {
      url.port = "5432";
    }
    for (const key of ["pgbouncer", "connection_limit", "pool_timeout"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

const env = { ...process.env };

if (!env.DATABASE_URL) {
  console.error("[start] DATABASE_URL is not set. Add it to the service environment and redeploy.");
  process.exit(1);
}

if (!env.DIRECT_URL) {
  env.DIRECT_URL = deriveDirectUrl(env.DATABASE_URL);
  console.warn("[start] DIRECT_URL not set; derived it from DATABASE_URL for migrations.");
}

const bin = (name) => (process.platform === "win32" ? `${name}.cmd` : name);

if (env.SKIP_MIGRATIONS !== "1") {
  const migrate = spawnSync(bin("npx"), ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (migrate.status !== 0) {
    console.error(`[start] prisma migrate deploy failed (exit ${migrate.status}).`);
    process.exit(migrate.status ?? 1);
  }
}

const args = ["next", "start"];
if (env.PORT) args.push("-p", env.PORT);
const server = spawn(bin("npx"), args, { stdio: "inherit", env, shell: process.platform === "win32" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
