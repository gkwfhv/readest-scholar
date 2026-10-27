import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

const [archiveArg, rootArg, scope, target, output] = process.argv.slice(2);
const scopes = new Set(["macos-app-files", "windows-install-dir-files"]);
if (!archiveArg || !rootArg || !scopes.has(scope) || !target || !output) {
  console.error(
    "Usage: node inventory-scholar-installed.mjs <installer> <installed-directory> " +
    "<macos-app-files|windows-install-dir-files> <target> <output.json>"
  );
  process.exit(2);
}

async function sha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

const archive = await realpath(archiveArg);
const root = await realpath(rootArg);
if (!(await lstat(root)).isDirectory()) {
  throw new Error("Installed payload root is not a directory: " + root);
}

const archiveHash = await sha256(archive);
const appRef = "package:sha256:" + archiveHash;
const components = [];
async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const info = await lstat(path);
    if (info.isDirectory()) {
      await visit(path);
      continue;
    }
    if (!info.isFile() && !info.isSymbolicLink()) {
      throw new Error("Unsupported installed payload entry: " + path);
    }
    const name = relative(root, path).split(sep).join("/");
    const component = {
      type: "file",
      "bom-ref": "file:sha256:" + createHash("sha256").update(name).digest("hex"),
      name,
    };
    if (info.isSymbolicLink()) {
      component.properties = [{
        name: "scholar:symlink-target",
        value: await readlink(path),
      }];
    } else {
      component.hashes = [{ alg: "SHA-256", content: await sha256(path) }];
    }
    components.push(component);
  }
}
await visit(root);
components.sort((a, b) => a.name.localeCompare(b.name, "en"));
if (components.length === 0 || !components.some((part) => part.hashes)) {
  throw new Error("Installed payload contains no regular files");
}

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    component: {
      type: "application",
      "bom-ref": appRef,
      name: "readest-scholar",
      hashes: [{ alg: "SHA-256", content: archiveHash }],
      properties: [
        { name: "scholar:installer-filename", value: basename(archive) },
        { name: "scholar:inventory-scope", value: scope },
        { name: "scholar:target", value: target },
      ],
    },
  },
  components,
  dependencies: [{
    ref: appRef,
    dependsOn: components.map((part) => part["bom-ref"]),
  }],
};
await writeFile(output, JSON.stringify(bom, null, 2) + "\n");
console.log(
  "Inventoried " + components.length + " installed " + scope +
  " entries for " + basename(archive)
);
