import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024
})
  .split("\0")
  .filter(Boolean);

const highConfidencePatterns = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["stripe-live-key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g]
];

const localHosts = new Set(["127.0.0.1", "localhost", "db", "postgres"]);
const placeholderWords =
  /change|example|placeholder|password|postgres|test|build|replace|secret|redacted|masked|demo|dummy/i;
const findings = [];

for (const file of tracked) {
  let content;
  try {
    const buffer = readFileSync(file);
    if (buffer.length > 2 * 1024 * 1024 || buffer.includes(0)) continue;
    content = buffer.toString("utf8");
  } catch {
    continue;
  }

  for (const [rule, pattern] of highConfidencePatterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split("\n").length;
      findings.push({ file, line, rule });
    }
  }

  const databaseUrls = content.matchAll(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi);
  for (const match of databaseUrls) {
    try {
      const parsed = new URL(match[0]);
      const password = decodeURIComponent(parsed.password);
      const isExampleHost = parsed.hostname.endsWith(".example") || parsed.hostname.endsWith(".example.test");
      const isObviousPlaceholder = placeholderWords.test(password) || password.length <= 4;
      if (!password || localHosts.has(parsed.hostname) || isExampleHost || isObviousPlaceholder) continue;
      const line = content.slice(0, match.index).split("\n").length;
      findings.push({ file, line, rule: "non-local-database-credential" });
    } catch {
      // Invalid example URLs are not credentials and are ignored.
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found (values intentionally hidden):");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}]`);
  }
  process.exit(1);
}

console.log(`Secret scan passed for ${tracked.length} tracked files.`);
