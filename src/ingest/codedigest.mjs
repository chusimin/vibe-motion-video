// code 类型:遍历目录,生成文件树概要 + 关键文件内容摘要。
import { promises as fs } from "node:fs";
import path from "node:path";

// 跳过的目录/文件(噪音 + 大目录)
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  ".cache", ".turbo", ".vercel", ".svelte-kit", "coverage", "__pycache__",
  ".venv", "venv", "vendor", ".idea", ".vscode", "target", ".gradle",
  ".pytest_cache", ".mypy_cache", ".DS_Store",
]);

// 关键文件优先级(命中即读全文/截断)
const KEY_FILES = [
  /^readme(\.(md|markdown|txt|rst))?$/i,
  /^package\.json$/i,
  /^pyproject\.toml$/i,
  /^cargo\.toml$/i,
  /^go\.mod$/i,
  /^requirements\.txt$/i,
  /^index\.(html?|jsx?|tsx?|mjs|cjs|vue|svelte)$/i,
  /^main\.(jsx?|tsx?|mjs|py|go|rs|java)$/i,
  /^app\.(jsx?|tsx?|mjs|py|vue)$/i,
  /^manifest\.json$/i,        // 浏览器插件
];

// 源码扩展名(用于文件树标注 + 兜底主入口探测)
const SOURCE_EXT = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue", ".svelte",
  ".py", ".go", ".rs", ".java", ".rb", ".php", ".html", ".css",
  ".json", ".md", ".toml", ".yml", ".yaml",
]);

const MAX_FILE_BYTES = 16 * 1024;   // 单文件读取上限
const MAX_TREE_ENTRIES = 400;       // 文件树最多列出条目
const MAX_KEY_FILES = 12;           // 最多详读多少关键文件
const MAX_DEPTH = 6;

function isKey(name) {
  return KEY_FILES.some((re) => re.test(name));
}

// 递归收集文件(广度优先思路,带深度/数量上限)
async function walk(root) {
  const entries = [];   // { rel, isDir, size }
  const queue = [{ abs: root, rel: "", depth: 0 }];
  while (queue.length) {
    const { abs, rel, depth } = queue.shift();
    let dirents;
    try { dirents = await fs.readdir(abs, { withFileTypes: true }); }
    catch { continue; }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirents) {
      if (d.name.startsWith(".") && d.name !== ".env.example") {
        // 跳过隐藏文件(保留少量有意义的),并跳过隐藏目录
        if (d.isDirectory()) continue;
        if (![".gitignore", ".env.example"].includes(d.name)) continue;
      }
      if (SKIP_DIRS.has(d.name)) continue;
      const childRel = rel ? path.join(rel, d.name) : d.name;
      const childAbs = path.join(abs, d.name);
      if (d.isDirectory()) {
        entries.push({ rel: childRel, isDir: true });
        if (depth < MAX_DEPTH) queue.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
      } else if (d.isFile()) {
        let size = 0;
        try { size = (await fs.stat(childAbs)).size; } catch {}
        entries.push({ rel: childRel, isDir: false, size, abs: childAbs });
      }
      if (entries.length >= MAX_TREE_ENTRIES * 2) return entries;
    }
  }
  return entries;
}

function fmtSize(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

// 生成文件树文本(目录优先,截断)
function renderTree(entries) {
  const shown = entries.slice(0, MAX_TREE_ENTRIES);
  const lines = shown.map((e) => {
    const depth = e.rel.split(path.sep).length - 1;
    const indent = "  ".repeat(depth);
    const base = path.basename(e.rel);
    return e.isDir ? `${indent}${base}/` : `${indent}${base}  (${fmtSize(e.size || 0)})`;
  });
  if (entries.length > MAX_TREE_ENTRIES) {
    lines.push(`… 其余 ${entries.length - MAX_TREE_ENTRIES} 项省略`);
  }
  return lines.join("\n");
}

async function readClip(abs, size) {
  try {
    const fh = await fs.open(abs, "r");
    try {
      const len = Math.min(size || MAX_FILE_BYTES, MAX_FILE_BYTES);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      let txt = buf.subarray(0, bytesRead).toString("utf8");
      if ((size || 0) > MAX_FILE_BYTES) txt += "\n…(文件已截断)";
      return txt;
    } finally { await fh.close(); }
  } catch { return ""; }
}

// 主函数:返回 { markdown, title, summary, fileCount, keyFiles:[rel] }
export async function buildCodeDigest(dir) {
  const root = path.resolve(dir);
  const name = path.basename(root);
  const entries = await walk(root);
  const files = entries.filter((e) => !e.isDir);

  // 选关键文件:KEY_FILES 命中优先,浅层优先,小文件优先
  const keyCandidates = files
    .filter((f) => isKey(path.basename(f.rel)))
    .sort((a, b) => {
      const da = a.rel.split(path.sep).length, db = b.rel.split(path.sep).length;
      if (da !== db) return da - db;
      return (a.size || 0) - (b.size || 0);
    })
    .slice(0, MAX_KEY_FILES);

  // 尝试解析 package.json 提炼标题/描述
  let title = name;
  let summary = "";
  const pkgEntry = files.find((f) => path.basename(f.rel).toLowerCase() === "package.json"
    && f.rel.split(path.sep).length === 1);
  if (pkgEntry) {
    try {
      const pkg = JSON.parse(await readClip(pkgEntry.abs, pkgEntry.size));
      if (pkg.name) title = pkg.name;
      if (pkg.description) summary = pkg.description;
    } catch {}
  }

  // 拼 markdown
  const parts = [];
  parts.push(`# 代码项目摘要:${name}`);
  parts.push(`\n来源目录:\`${root}\``);
  parts.push(`\n文件总数(已过滤 node_modules/.git 等):约 ${files.length}`);
  parts.push(`\n## 文件树\n\`\`\`\n${renderTree(entries)}\n\`\`\``);

  parts.push(`\n## 关键文件内容`);
  if (keyCandidates.length === 0) {
    parts.push("\n(未识别到 README/package.json/主入口等关键文件)");
  }
  for (const f of keyCandidates) {
    const content = await readClip(f.abs, f.size);
    if (!content.trim()) continue;
    const ext = path.extname(f.rel).slice(1) || "";
    parts.push(`\n### ${f.rel}\n\`\`\`${ext}\n${content}\n\`\`\``);
  }

  return {
    markdown: parts.join("\n"),
    title,
    summary,
    fileCount: files.length,
    keyFiles: keyCandidates.map((f) => f.rel),
  };
}
