import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = path.join(projectRoot, "apps", "api");
const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) throw new Error("npm_execpath is missing. Run this script through npm run test:e2e.");
const build = spawnSync(
  process.execPath,
  [npmCliPath, "run", "build", "--workspace", "@wasel/api"],
  { cwd: projectRoot, env: process.env, stdio: "inherit", shell: false }
);

if (build.error) throw build.error;
if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "dist/integration/phase11.e2e.test.js"],
    {
      cwd: apiDirectory,
      env: { ...process.env, RUN_DATABASE_E2E: "true" },
      stdio: "inherit",
      shell: false
    }
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
