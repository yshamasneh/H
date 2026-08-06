import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.resolve(root, argumentValue("env-file") ?? ".env.production");
const skipChecks = process.argv.includes("--skip-checks");
const requiredFiles = [
  "Dockerfile",
  "docker-compose.production.yml",
  "deploy/nginx/default.conf",
  "docs/privacy-policy.md",
  "docs/terms-of-service.md",
  "docs/operations-runbook.md",
  "docs/store-listing.md",
  "apps/mobile/assets/store/app-icon-1024.png",
  "apps/mobile/eas.json"
];

for (const relativePath of requiredFiles) await requireFile(relativePath);
await validatePng(path.join(root, "apps/mobile/assets/store/app-icon-1024.png"), 1024, 1024);

const loaded = dotenv.config({ path: envFile });
if (loaded.error) throw new Error(`Could not load ${envFile}. Copy .env.production.example and replace every placeholder.`);
const environment = { ...process.env, ...loaded.parsed };
run(
  process.execPath,
  [
    "--import",
    "tsx",
    "--require",
    "./scripts/node-platform-shim.cjs",
    "--eval",
    "import { validateEnvironment } from './apps/api/src/config/environment.ts'; validateEnvironment(process.env);"
  ],
  environment,
  "production environment validation"
);

if (!skipChecks) {
  for (const [script, label] of [
    ["lint", "lint"],
    ["typecheck", "typecheck"],
    ["test", "tests"],
    ["build", "build"],
    ["prisma:validate", "Prisma schema"]
  ]) {
    run(npmCommand(), ["run", script], environment, label);
  }
}

console.log("Release readiness checks passed.");

async function requireFile(relativePath) {
  const filePath = path.join(root, relativePath);
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile() || details.size === 0) throw new Error(`Required release file is missing or empty: ${relativePath}`);
}

async function validatePng(filePath, expectedWidth, expectedHeight) {
  const data = await readFile(filePath);
  if (data.length < 24 || data.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error("Store icon is not a valid PNG.");
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`Store icon must be ${expectedWidth}x${expectedHeight}; found ${width}x${height}.`);
  }
}

function run(command, args, environment, label) {
  console.log(`[release] Checking ${label}...`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, env: environment });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
