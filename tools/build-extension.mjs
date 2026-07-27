import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const source = path.join(root, "extension");
const outRoot = path.join(root, "dist");

const targets = [
  {
    name: "chrome",
    manifest: "manifest.json",
    skip: ["manifest.firefox.json", "media-content.js"]
  },
  {
    name: "firefox",
    manifest: "manifest.firefox.json",
    skip: ["manifest.json", "manifest.firefox.json", "offscreen.html", "offscreen.js"]
  }
];

const version = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8")).version;

function relativeName(file) {
  return path.relative(source, file).split(path.sep).join("/");
}

function copyTree(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    if (skip.includes(relativeName(src))) continue;
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(src, dst, skip);
    } else {
      fs.copyFileSync(src, dst);
      count += 1;
    }
  }
  return count;
}

function referencedScripts(manifest) {
  const files = [];
  const background = manifest.background || {};
  if (background.service_worker) files.push(background.service_worker);
  for (const script of background.scripts || []) files.push(script);
  for (const entry of manifest.content_scripts || []) {
    for (const script of entry.js || []) files.push(script);
  }
  if (manifest.action && manifest.action.default_popup) files.push(manifest.action.default_popup);
  return files;
}

const problems = [];

for (const target of targets) {
  const out = path.join(outRoot, target.name);
  fs.rmSync(out, { recursive: true, force: true });
  const count = copyTree(source, out, target.skip);

  const manifest = JSON.parse(fs.readFileSync(path.join(source, target.manifest), "utf8"));
  manifest.version = version;
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  for (const file of referencedScripts(manifest)) {
    if (!fs.existsSync(path.join(out, file))) {
      problems.push(`${target.name}: manifest references missing file "${file}"`);
    }
  }

  console.log(`${target.name}: ${count + 1} files in dist/${target.name} (version ${version})`);
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
