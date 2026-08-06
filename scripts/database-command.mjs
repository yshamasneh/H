import { spawn } from "node:child_process";

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

  const args = [
    "--host", parsed.hostname,
    "--port", parsed.port || "5432",
    "--username", decodeURIComponent(parsed.username),
    "--dbname", database
  ];
  const environment = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(parsed.password),
    ...(parsed.searchParams.get("sslmode") ? { PGSSLMODE: parsed.searchParams.get("sslmode") } : {})
  };
  return { args, database, environment };
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

export function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
