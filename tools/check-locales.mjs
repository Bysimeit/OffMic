import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(here, "..", "extension", "_locales");
const reference = "en";

function readLocale(code) {
  const file = path.join(localesDir, code, "messages.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function placeholdersOf(message) {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
}

const codes = fs
  .readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (!codes.includes(reference)) {
  console.error(`Missing reference locale "${reference}" in ${localesDir}`);
  process.exit(1);
}

const dicts = {};
for (const code of codes) {
  dicts[code] = readLocale(code);
}

const referenceKeys = Object.keys(dicts[reference]);
const problems = [];

for (const code of codes) {
  if (code === reference) continue;
  const keys = Object.keys(dicts[code]);
  for (const key of referenceKeys) {
    if (!keys.includes(key)) problems.push(`${code}: missing key "${key}"`);
  }
  for (const key of keys) {
    if (!referenceKeys.includes(key)) problems.push(`${code}: unknown key "${key}"`);
  }
}

for (const code of codes) {
  for (const key of Object.keys(dicts[code])) {
    if (!referenceKeys.includes(key)) continue;
    const actual = placeholdersOf(dicts[code][key].message);
    const expected = placeholdersOf(dicts[reference][key].message);
    if (actual !== expected) {
      problems.push(`${code}: key "${key}" has placeholders [${actual}], expected [${expected}]`);
    }
  }
}

for (const code of codes) {
  for (const key of Object.keys(dicts[code])) {
    const message = dicts[code][key].message;
    if (typeof message !== "string" || !message.trim()) {
      problems.push(`${code}: key "${key}" has an empty message`);
    }
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}

console.log(`${codes.length} locales checked (${codes.join(", ")}), ${referenceKeys.length} keys each. All consistent.`);
