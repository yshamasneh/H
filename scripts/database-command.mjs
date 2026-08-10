import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

/**
 * Loads the repository .env so `npm run db:backup` works without the caller exporting
 * DATABASE_URL by hand. Values already present in the real environment always win, so an
 * inline `DATABASE_URL=... npm run db:backup` still overrides the file.
 */
export function loadEnvironmentFile(fileName = ".env") {
  const alreadySet = new Map(Object.entries(process.env));
  try {
    process.loadEnvFile(path.join(repositoryRoot, fileName));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  for (const [key, value] of alreadySet) process.env[key] = value;
  return true;
}

export function databaseConnection(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("The database URL is invalid.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Only PostgreSQL database URLs are supported.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database || !parsed.hostname || !parsed.username) {
    throw new Error("The database URL must include a host, user, and database name.");
  }

  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const args = [
    "--host", host,
    "--port", port,
    "--username", decodeURIComponent(parsed.username),
    "--dbname", database
  ];
  const environment = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(parsed.password),
    ...(parsed.searchParams.get("sslmode") ? { PGSSLMODE: parsed.searchParams.get("sslmode") } : {})
  };
  return { args, database, host, port, username: decodeURIComponent(parsed.username), environment };
}

export function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, env: environment });
    child.once("error", (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? `exit ${code ?? "unknown"}`}).`));
    });
  });
}

function capture(command, args, environment = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, env: environment });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", () => resolve({ ok: false, stdout, stderr }));
    child.once("exit", (code) => resolve({ ok: code === 0, stdout, stderr }));
  });
}

export function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function localToolName(tool) {
  return process.platform === "win32" ? `${tool}.exe` : tool;
}

async function discoverPostgresContainer() {
  const listed = await capture("docker", ["ps", "--format", "{{.Names}}\t{{.Image}}"]);
  if (!listed.ok) return { names: [], dockerAvailable: false };
  const names = listed.stdout
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter(([name, image]) => name && /postgres/i.test(image ?? ""))
    .map(([name]) => name);
  return { names, dockerAvailable: true };
}

/**
 * Resolves how to invoke the PostgreSQL client tools. The client tools are not installed on
 * every machine that runs this repository — the database itself lives in the `db` service from
 * docker-compose.yml — so we fall back to running them inside that container and transferring
 * the dump file across. Resolution order is explicit config, then a local install, then a
 * single running postgres container.
 */
export async function postgresRunner(tool) {
  const configuredContainer = argumentValue("container") ?? process.env.PG_DOCKER_CONTAINER;
  if (configuredContainer) return dockerRunner(configuredContainer, "PG_DOCKER_CONTAINER");

  const local = localToolName(tool);
  if ((await capture(local, ["--version"])).ok) return localRunner();

  const { names, dockerAvailable } = await discoverPostgresContainer();
  if (names.length === 1) return dockerRunner(names[0], "a running container");
  if (names.length > 1) {
    throw new Error(
      `${local} is not installed and several PostgreSQL containers are running (${names.join(", ")}). ` +
        "Re-run with --container=<name> or set PG_DOCKER_CONTAINER."
    );
  }
  throw new Error(
    `${local} is not installed and no running PostgreSQL container was found` +
      `${dockerAvailable ? "" : " (the docker CLI is also unavailable)"}. ` +
      "Start the database with `npm run db:up`, install the PostgreSQL client tools, or set PG_DOCKER_CONTAINER."
  );
}

function localRunner() {
  return {
    describe: "the locally installed PostgreSQL client tools",
    connectionArgs: (connection) => connection.args,
    exec: (tool, args, environment) => run(localToolName(tool), args, environment),
    async withFile(_direction, localPath, body) {
      return body(localPath);
    }
  };
}

function dockerRunner(container, source) {
  const internalPort = process.env.PG_DOCKER_PORT ?? "5432";
  return {
    describe: `PostgreSQL client tools inside container "${container}" (from ${source})`,
    /**
     * Inside the container the server is always reachable on its own internal port, which is not
     * necessarily the port published to the host in DATABASE_URL.
     */
    connectionArgs: (connection) => [
      "--host", "127.0.0.1",
      "--port", internalPort,
      "--username", connection.username,
      "--dbname", connection.database
    ],
    exec(tool, args, environment = process.env) {
      // `-e NAME` without a value forwards the value from this process, keeping the password
      // out of the docker CLI's argv.
      const forwarded = ["PGPASSWORD", "PGSSLMODE"]
        .filter((name) => environment[name] !== undefined)
        .flatMap((name) => ["-e", name]);
      return run("docker", ["exec", ...forwarded, container, tool, ...args], environment);
    },
    async withFile(direction, localPath, body) {
      const remotePath = `/tmp/${path.basename(localPath)}`;
      if (direction === "input") {
        await run("docker", ["cp", localPath, `${container}:${remotePath}`]);
      }
      try {
        const result = await body(remotePath);
        if (direction === "output") {
          await run("docker", ["cp", `${container}:${remotePath}`, localPath]);
        }
        return result;
      } finally {
        await capture("docker", ["exec", container, "rm", "-f", remotePath]);
      }
    }
  };
}
