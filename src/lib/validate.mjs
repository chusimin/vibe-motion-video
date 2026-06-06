// JSON Schema 校验(ajv)。校验 brief/config/storyboard。
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { UserError } from "./log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "../../schemas");

const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new Map();

async function loadSchema(name) {
  if (cache.has(name)) return cache.get(name);
  const txt = await fs.readFile(path.join(SCHEMA_DIR, `${name}.schema.json`), "utf8");
  const validate = ajv.compile(JSON.parse(txt));
  cache.set(name, validate);
  return validate;
}

// 返回 { ok, errors:[字符串] }
export async function validate(name, data) {
  const v = await loadSchema(name);
  const ok = v(data);
  const errors = ok ? [] : (v.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);
  return { ok, errors };
}

export async function assertValid(name, data) {
  const { ok, errors } = await validate(name, data);
  if (!ok) throw new UserError(`${name} 校验失败:\n  - ${errors.join("\n  - ")}`);
  return true;
}
