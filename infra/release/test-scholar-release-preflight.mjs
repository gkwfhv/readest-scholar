import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "scholar-release-preflight-"));
const script = new URL("./verify-scholar-release-preflight.mjs", import.meta.url);
const commit = "a".repeat(40), run = "123456", version = "0.12.17";
const artifacts = [["scholar-linux-x86_64-debug", "x86_64-unknown-linux-gnu"], ["scholar-desktop-aarch64-apple-darwin-debug", "aarch64-apple-darwin"], ["scholar-desktop-x86_64-apple-darwin-debug", "x86_64-apple-darwin"], ["scholar-desktop-x86_64-pc-windows-msvc-debug", "x86_64-pc-windows-msvc"]];
try {
  for (const [artifactName, target] of artifacts) {
    const directory = join(root, artifactName); await mkdir(directory);
    await writeFile(join(directory, "PROVENANCE.json"), JSON.stringify({ schemaVersion: 1, status: "unsigned-debug-candidate", releaseReady: false, product: "Readest Scholar", repository: "gkwfhv/readest-scholar", sourceCommit: commit, workflowRunId: run, version, target, artifactName, bundle: { filename: `Readest Scholar_${version}_test`, sha256: "b".repeat(64) }, evidence: { installedFiles: 1, installedFileInventorySha256: "c".repeat(64), npmLicenseReportSha256: "d".repeat(64) } }));
  }
  const args = [script.pathname, root, commit, version, run, `v${version}`, "SCHOLAR-REL-001", join(root, "RELEASE-PREFLIGHT.json")];
  const accepted = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (accepted.status !== 0) throw new Error(accepted.stderr);
  const report = JSON.parse(await readFile(join(root, "RELEASE-PREFLIGHT.json"), "utf8"));
  if (report.candidates.length !== 4 || report.releaseReady !== false) throw new Error("Expected unsigned four-platform preflight report");
  await rm(join(root, "RELEASE-PREFLIGHT.json"));
  const windows = join(root, "scholar-desktop-x86_64-pc-windows-msvc-debug", "PROVENANCE.json");
  const tampered = JSON.parse(await readFile(windows, "utf8")); tampered.workflowRunId = "654321"; await writeFile(windows, JSON.stringify(tampered));
  const rejected = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (rejected.status === 0 || !rejected.stderr.includes("mismatched candidate provenance")) throw new Error("Mismatched candidate run ID was accepted");
  console.log("Scholar release preflight accepts matching candidates and rejects a mismatched run");
} finally { await rm(root, { recursive: true, force: true }); }
