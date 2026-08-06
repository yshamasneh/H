import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";
const npmCliPath = process.env.npm_execpath;
const serviceDefinitions = [
  {
    key: "api",
    label: "API",
    port: 3000,
    probeUrl: "http://127.0.0.1:3000/api/v1/health",
    matches: (response, body) => response.ok && body.includes('"database":"connected"'),
    entryPoint: "node_modules/@nestjs/cli/bin/nest.js",
    args: ["start", "--watch"],
    workingDirectory: "apps/api"
  },
  {
    key: "app",
    label: "customer / restaurant / driver web app",
    port: 8081,
    probeUrl: "http://127.0.0.1:8081",
    matches: (response, body) => response.ok && body.includes("<title>TasawaQ</title>"),
    entryPoint: "node_modules/expo/bin/cli",
    args: ["start", "--web", "--port", "8081"],
    workingDirectory: "apps/mobile"
  }
];

if (!npmCliPath) {
  throw new Error("npm_execpath is missing. Start this script through npm run web.");
}

function runNpm(args, label) {
  run(process.execPath, [npmCliPath, ...args], label);
}

function run(command, args, label) {
  console.log(`\n[setup] ${label}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
  });
}

async function matchesExistingService(service) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(service.probeUrl, { signal: AbortSignal.timeout(1_500) });
      const body = await response.text();
      if (service.matches(response, body)) return true;
    } catch {
      // A previous development process may still be finishing its startup.
    }
    await delay(300);
  }
  return false;
}

async function findServicesToStart() {
  const servicesToStart = [];
  for (const service of serviceDefinitions) {
    if (await isPortAvailable(service.port)) {
      servicesToStart.push(service);
      continue;
    }
    if (!(await matchesExistingService(service))) {
      throw new Error(
        `Port ${service.port} is used by another application, not by the expected TasawaQ ${service.key} service.`
      );
    }
    console.log(`[reuse] ${service.label} is already running on port ${service.port}.`);
  }
  return servicesToStart;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDatabase() {
  console.log("[setup] Waiting for PostgreSQL to become healthy...");
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      dockerCommand,
      ["compose", "exec", "-T", "db", "pg_isready"],
      { cwd: projectRoot, stdio: "ignore", shell: false }
    );
    if (result.status === 0) {
      console.log("[setup] PostgreSQL is ready.");
      return;
    }
    await delay(1_000);
  }
  throw new Error("PostgreSQL did not become healthy within 30 seconds. Check Docker Desktop and run npm run web again.");
}

function startService(service) {
  console.log(`[start] ${service.label}`);
  return spawn(process.execPath, [path.join(projectRoot, service.entryPoint), ...service.args], {
    cwd: path.join(projectRoot, service.workingDirectory),
    stdio: "inherit",
    shell: false
  });
}

let shuttingDown = false;
let services = [];

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const service of services) {
    if (!service.killed) service.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

async function main() {
  const servicesToStart = await findServicesToStart();
  run(dockerCommand, ["compose", "up", "-d", "db"], "Starting PostgreSQL in Docker");
  await waitForDatabase();
  runNpm(["run", "prisma:generate"], "Generating the Prisma client");
  runNpm(["run", "prisma:deploy"], "Applying database migrations");
  runNpm(["run", "prisma:seed"], "Loading idempotent demo data");

  console.log("\nTasawaQ development services are starting:");
  console.log("  App web (all roles): http://localhost:8081");
  console.log("  API docs:            http://localhost:3000/api/docs");
  if (servicesToStart.length === 0) {
    console.log("\nAll TasawaQ services were already running; nothing else needs to be started.\n");
    return;
  }

  console.log("\nPress Ctrl+C once to stop the services started by this command. PostgreSQL data remains saved in Docker.\n");

  services = servicesToStart.map(startService);

  for (const service of services) {
    service.once("exit", (code, signal) => {
      if (shuttingDown) return;
      console.error(`\nA development service stopped unexpectedly (${signal ?? `exit ${code ?? "unknown"}`}).`);
      shutdown(code || 1);
    });
    service.once("error", (error) => {
      if (shuttingDown) return;
      console.error(`\nCould not start a development service: ${error.message}`);
      shutdown(1);
    });
  }
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(`\n[startup error] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
