// 预设加载:平台 / 结构 / 风格。
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "./log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESET_DIR = path.resolve(__dirname, "../../presets");

export async function loadPreset(kind, name) {
  const file = path.join(PRESET_DIR, kind, `${name}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new UserError(`找不到预设 ${kind}/${name}。可用:${(await listPresets(kind)).join(", ") || "(空)"}`);
  }
}

export async function listPresets(kind) {
  try {
    const files = await fs.readdir(path.join(PRESET_DIR, kind));
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch { return []; }
}
