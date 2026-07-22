import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const target = path.join(root, "extension", "config.js");

function parseEnv(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

const production = process.argv.includes("--production");

const base = parseEnv(path.join(root, ".env"));
const local = production ? {} : parseEnv(path.join(root, ".env.local"));
const env = Object.assign({}, base, local);
const source = local.OFFMIC_SERVER_URL ? ".env.local" : ".env";

const serverUrl = env.OFFMIC_SERVER_URL;

if (!serverUrl) {
  console.error("OFFMIC_SERVER_URL is not defined in .env or .env.local");
  process.exit(1);
}

if (!/^wss?:\/\/.+/.test(serverUrl)) {
  console.error(`OFFMIC_SERVER_URL must start with ws:// or wss:// (got "${serverUrl}")`);
  process.exit(1);
}

const contents = `const OFFMIC_CONFIG = {\n  serverUrl: ${JSON.stringify(serverUrl)}\n};\n`;
fs.writeFileSync(target, contents);

console.log(`wrote extension/config.js from ${source}`);
console.log(`  serverUrl = ${serverUrl}`);

if (source === ".env.local") {
  console.log("");
  console.log("  DEVELOPMENT BUILD, do not package this.");
  console.log("  Run: node tools/build-config.mjs --production");
}
