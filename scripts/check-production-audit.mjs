import { spawnSync } from "node:child_process";
import process from "node:process";

const acceptedHighAdvisories = new Set([
  "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
  "https://github.com/advisories/GHSA-ggr8-5vv4-36mx",
  "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr"
]);

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) {
  console.error("Run this check through npm run security:audit:production.");
  process.exit(2);
}

const result = spawnSync(process.execPath, [npmCliPath, "audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
  shell: false
});

if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("Production dependency audit did not return valid JSON.");
  process.exit(2);
}

if (report.error) {
  console.error("Production dependency audit could not complete.");
  process.exit(2);
}

const counts = report.metadata?.vulnerabilities ?? {};
const advisories = new Map();
for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via ?? []) {
    if (typeof via !== "object" || !via.url) continue;
    advisories.set(via.url, {
      packageName,
      severity: via.severity,
      url: via.url
    });
  }
}

const rejected = [...advisories.values()].filter(
  (advisory) =>
    advisory.severity === "critical" ||
    (advisory.severity === "high" && !acceptedHighAdvisories.has(advisory.url))
);

console.log(
  `Production audit: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ` +
    `${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low affected package nodes.`
);

if ((counts.critical ?? 0) > 0 || rejected.length > 0) {
  for (const advisory of rejected) {
    console.error(`${advisory.severity.toUpperCase()}: ${advisory.packageName} (${advisory.url})`);
  }
  process.exit(1);
}

const observedAccepted = [...advisories.values()].filter(
  (advisory) => advisory.severity === "high" && acceptedHighAdvisories.has(advisory.url)
);
console.log(
  `Accepted high advisory roots: ${observedAccepted.length}; see docs/dependency-security-review.md.`
);
