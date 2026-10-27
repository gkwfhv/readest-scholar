import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: node check-scholar-rustsec.mjs <cargo-audit.json>");
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const findings = report?.vulnerabilities?.list;
if (!Array.isArray(findings) || report.vulnerabilities.count !== findings.length) {
  throw new Error("Expected a complete cargo-audit JSON vulnerability report");
}

// These findings remain release blockers. This baseline only prevents
// unnoticed drift while the updater, LocalSend, and Turso/Tantivy paths are reviewed.
const known = new Set([
  "RUSTSEC-2021-0119|nix|0.19.1",
  "RUSTSEC-2023-0071|rsa|0.9.10",
  "RUSTSEC-2026-0367|zip|4.6.1",
  "RUSTSEC-2026-0368|zip|4.6.1",
  "RUSTSEC-2026-0369|zip|4.6.1",
]);
const observed = new Set();
const unexpected = [];
for (const finding of findings) {
  const id = finding?.advisory?.id;
  const name = finding?.package?.name;
  const version = finding?.package?.version;
  if (typeof id !== "string" || typeof name !== "string" ||
      typeof version !== "string") {
    throw new Error("Malformed RustSec finding in cargo-audit report");
  }
  const key = [id, name, version].join("|");
  if (observed.has(key) || !known.has(key)) unexpected.push(key);
  observed.add(key);
}

if (unexpected.length) {
  throw new Error(
    "New, changed, or duplicate RustSec finding(s): " + unexpected.join(", ")
  );
}
console.log(
  "RustSec drift check: " + findings.length +
  " known unresolved finding(s); no new findings"
);
if (findings.length) {
  console.log(
    "::warning::The known RustSec findings remain release blockers; " +
    "a green drift check is not vulnerability acceptance."
  );
}
