import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
const [rootArg, sourceCommit, version, workflowRunId, releaseTag, approvalReference, outputArg] = process.argv.slice(2);
const expected = new Map([
  ["scholar-linux-x86_64-debug", { target: "x86_64-unknown-linux-gnu", artifactName: "scholar-linux-x86_64-debug" }],
  ["scholar-desktop-aarch64-apple-darwin-debug", { target: "aarch64-apple-darwin", artifactName: "scholar-desktop-aarch64-apple-darwin-debug" }],
  ["scholar-desktop-x86_64-apple-darwin-debug", { target: "x86_64-apple-darwin", artifactName: "scholar-desktop-x86_64-apple-darwin-debug" }],
  ["scholar-desktop-x86_64-pc-windows-msvc-debug", { target: "x86_64-pc-windows-msvc", artifactName: "scholar-desktop-x86_64-pc-windows-msvc-debug" }],
]);
if (!rootArg || !/^[0-9a-f]{40}$/.test(sourceCommit ?? "") || !/^\d+\.\d+\.\d+$/.test(version ?? "") || !/^[1-9][0-9]{5,}$/.test(workflowRunId ?? "") || releaseTag !== `v${version}` || !/^[A-Za-z0-9._/-]{6,160}$/.test(approvalReference ?? "") || !outputArg) {
  console.error("Usage: node verify-scholar-release-preflight.mjs <candidate-root> <40-char-commit> <version> <candidate-run-id> <vX.Y.Z-tag> <approval-reference> <output.json>");
  process.exit(2);
}
const root = resolve(rootArg);
const output = resolve(outputArg);
if (resolve(root, basename(output)) !== output || basename(output) !== "RELEASE-PREFLIGHT.json") throw new Error("Output must be candidate-root/RELEASE-PREFLIGHT.json");
const entries = await readdir(root, { withFileTypes: true });
const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const expectedNames = [...expected.keys()].sort();
if (directories.length !== expectedNames.length || directories.some((name, index) => name !== expectedNames[index])) throw new Error("Candidate root does not contain exactly the four required Scholar artifacts");
for (const entry of entries) if (!entry.isDirectory() && entry.name !== basename(output)) throw new Error("Candidate root contains unexpected file: " + entry.name);
const candidates = [];
for (const name of expectedNames) {
  const provenance = JSON.parse(await readFile(resolve(root, name, "PROVENANCE.json"), "utf8"));
  const target = expected.get(name);
  if (provenance?.schemaVersion !== 1 || provenance.status !== "unsigned-debug-candidate" || provenance.releaseReady !== false || provenance.product !== "Readest Scholar" || provenance.repository !== "gkwfhv/readest-scholar" || provenance.sourceCommit !== sourceCommit || provenance.workflowRunId !== workflowRunId || provenance.version !== version || provenance.target !== target.target || provenance.artifactName !== target.artifactName || !/^[0-9a-f]{64}$/.test(provenance.bundle?.sha256 ?? "") || !/^[^/\\]+$/.test(provenance.bundle?.filename ?? "") || !Number.isInteger(provenance.evidence?.installedFiles) || provenance.evidence.installedFiles < 1 || !/^[0-9a-f]{64}$/.test(provenance.evidence?.installedFileInventorySha256 ?? "") || !/^[0-9a-f]{64}$/.test(provenance.evidence?.npmLicenseReportSha256 ?? "")) throw new Error("Invalid or mismatched candidate provenance: " + name);
  candidates.push({ artifactName: name, target: provenance.target, bundle: provenance.bundle, installedFiles: provenance.evidence.installedFiles });
}
const preflight = { schemaVersion: 1, status: "preflight-passed-unsigned-candidates", product: "Readest Scholar", releaseTag, sourceCommit, candidateWorkflowRunId: workflowRunId, approvalReference, candidates, releaseReady: false, remainingRequirements: ["protected-environment approval", "platform signing and notarization", "legal, license, and residual-security approval", "separate release authorization"] };
await writeFile(output, JSON.stringify(preflight, null, 2) + "\n", { flag: "wx" });
console.log(`Validated ${candidates.length} unsigned Scholar candidates for ${releaseTag}`);
