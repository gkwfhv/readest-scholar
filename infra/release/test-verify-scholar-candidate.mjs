import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "scholar-candidate-provenance-"));
const script = new URL("./verify-scholar-candidate.mjs", import.meta.url);
const version = JSON.parse(await readFile("apps/readest-app/src-tauri/scholar.release.json", "utf8")).version;
const releaseWorkflow = await readFile(".github/workflows/scholar-unsigned-release.yml", "utf8");
if (!releaseWorkflow.includes("scope=unsigned public release; not signed; no platform code signature")) {
  throw new Error("Unsigned release workflow does not record its unsigned scope");
}
const commit = "a".repeat(40);
const runId = "40666304134";
const target = "x86_64-unknown-linux-gnu";
const bundle = "Readest Scholar_" + version + "_x86_64.deb";
const bundleBytes = Buffer.from("test-only-unsigned-scholar-bundle");
const bundleHash = createHash("sha256").update(bundleBytes).digest("hex");

async function createCandidate(profile) {
  const candidate = join(root, profile);
  await mkdir(candidate);
  await writeFile(join(candidate, bundle), bundleBytes);
  await writeFile(join(candidate, "SHA256SUMS"), bundleHash + "  " + bundle + "\n");
  await writeFile(join(candidate, "BUILD.txt"), [
    profile === "release"
      ? "Readest Scholar unsigned release candidate"
      : "Readest Scholar unsigned debug candidate",
    "commit=" + commit,
    "runner=ubuntu-22.04",
    "bundle=deb",
    "scope=not signed",
    "",
  ].join("\n"));
  await writeFile(join(candidate, "PAYLOAD-FILES.cdx.json"), JSON.stringify({
    bomFormat: "CycloneDX",
    metadata: { component: {
      name: "readest-scholar",
      version,
      hashes: [{ alg: "SHA-256", content: bundleHash }],
      properties: [
        { name: "scholar:inventory-scope", value: "deb-payload-files" },
        { name: "scholar:architecture", value: "amd64" },
        { name: "scholar:installer-filename", value: bundle },
      ],
    } },
    components: [{
      type: "file",
      name: "usr/bin/readest-scholar",
      hashes: [{ alg: "SHA-256", content: bundleHash }],
    }],
  }));
  await writeFile(join(candidate, "npm-licenses.json"), JSON.stringify({ test: { license: "MIT" } }));
  return candidate;
}

try {
  for (const [profile, status, artifactName] of [
    ["debug", "unsigned-debug-candidate", "scholar-linux-x86_64-debug"],
    ["release", "unsigned-release-candidate", "scholar-linux-x86_64-unsigned"],
  ]) {
    const candidate = await createCandidate(profile);
    const provenance = join(candidate, "PROVENANCE.json");
    const result = spawnSync(process.execPath, [script.pathname, candidate, commit, target, runId, provenance, profile], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    const document = JSON.parse(await readFile(provenance, "utf8"));
    if (document.status !== status || document.artifactName !== artifactName || document.bundle.sha256 !== bundleHash) {
      throw new Error("Unexpected " + profile + " provenance");
    }
  }
  console.log("Scholar candidate provenance distinguishes debug and release artifacts");
} finally {
  await rm(root, { recursive: true, force: true });
}
