// ingest 增量素材收集:把发现的 logo/图片(png/jpg/svg/webp)复制/下载到 00_input/assets/。
//   限制:跳过 >5MB、最多 ~30 个、跳过 node_modules 等噪音目录。
//   供 `vibemotion assets` 闸门后续自动绑定到镜头。小工具,不污染主 ingest 逻辑。
import { promises as fs } from "node:fs";
import path from "node:path";
import { DIRS } from "../lib/project.mjs";

const MAX_ASSETS = 30;               // 最多收集多少个
const MAX_BYTES = 5 * 1024 * 1024;   // 单文件上限 5MB
const IMG_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg"]); // 收集的图片类型

// 与 codedigest 一致的跳过目录(噪音 + 大目录)
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  ".cache", ".turbo", ".vercel", ".svelte-kit", "coverage", "__pycache__",
  ".venv", "venv", "vendor", ".idea", ".vscode", "target", ".gradle",
]);

// 目标目录:00_input/assets
function assetsDir(project) {
  return project.p(DIRS.input, "assets");
}

// 唯一文件名(同名加序号),返回最终 basename
async function uniqueName(destDir, name, used) {
  let final = name;
  if (used.has(final)) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let i = 2;
    while (used.has(`${base}-${i}${ext}`)) i++;
    final = `${base}-${i}${ext}`;
  }
  used.add(final);
  return final;
}

// ── code 类型:从源码目录递归收集图片 ──────────────────────
// 优先 logo/icon/品牌图(文件名命中关键词)、浅层优先。
export async function collectAssetsFromDir(srcDir, project, log) {
  const root = path.resolve(srcDir);
  const found = [];
  const queue = [{ abs: root, depth: 0 }];
  const MAX_DEPTH = 6;
  while (queue.length && found.length < MAX_ASSETS * 4) {
    const { abs, depth } = queue.shift();
    let dirents;
    try { dirents = await fs.readdir(abs, { withFileTypes: true }); } catch { continue; }
    for (const d of dirents) {
      if (d.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(d.name)) continue;
      const childAbs = path.join(abs, d.name);
      if (d.isDirectory()) {
        if (depth < MAX_DEPTH) queue.push({ abs: childAbs, depth: depth + 1 });
      } else if (d.isFile()) {
        const ext = path.extname(d.name).slice(1).toLowerCase();
        if (!IMG_EXTS.has(ext)) continue;
        let size = 0;
        try { size = (await fs.stat(childAbs)).size; } catch { continue; }
        if (size > MAX_BYTES || size === 0) continue;
        found.push({ abs: childAbs, name: d.name, ext, size, depth });
      }
    }
  }
  if (!found.length) return 0;

  // 排序:logo/icon/brand 关键词优先 → 浅层优先 → 小文件优先
  const rank = (f) => {
    const l = f.name.toLowerCase();
    if (/logo|brand|wordmark/.test(l)) return 0;
    if (/icon|favicon|apple-touch/.test(l)) return 1;
    if (/screenshot|preview|hero|banner|cover/.test(l)) return 2;
    return 3;
  };
  found.sort((a, b) => (rank(a) - rank(b)) || (a.depth - b.depth) || (a.size - b.size));

  const picked = found.slice(0, MAX_ASSETS);
  const destDir = assetsDir(project);
  await fs.mkdir(destDir, { recursive: true });
  const used = new Set(await safeReaddir(destDir));
  let copied = 0;
  for (const f of picked) {
    try {
      const name = await uniqueName(destDir, f.name, used);
      await fs.copyFile(f.abs, path.join(destDir, name));
      copied++;
    } catch { /* 单个失败不致命 */ }
  }
  if (copied) log.dim(`ingest 顺带收集 ${copied} 个素材 → ${path.join(DIRS.input, "assets")}/(供 \`vibemotion assets\` 自动绑定)`);
  return copied;
}

// ── url 类型:从 HTML 抽 logo/图片 URL 并下载 ───────────────
export async function collectAssetsFromHtml(html, pageUrl, project, log) {
  const urls = extractImageUrls(html, pageUrl);
  if (!urls.length) return 0;

  const destDir = assetsDir(project);
  await fs.mkdir(destDir, { recursive: true });
  const used = new Set(await safeReaddir(destDir));
  let copied = 0;
  for (const u of urls) {
    if (copied >= MAX_ASSETS) break;
    try {
      const res = await fetch(u, {
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      const ext = extFromUrlOrType(u, ctype);
      if (!ext || !IMG_EXTS.has(ext)) continue;
      const len = Number(res.headers.get("content-length") || 0);
      if (len && len > MAX_BYTES) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) continue;
      const base = filenameFromUrl(u, ext);
      const name = await uniqueName(destDir, base, used);
      await fs.writeFile(path.join(destDir, name), buf);
      copied++;
    } catch { /* 单个下载失败跳过 */ }
  }
  if (copied) log.dim(`ingest 顺带下载 ${copied} 个站点素材 → ${path.join(DIRS.input, "assets")}/(供 \`vibemotion assets\` 自动绑定)`);
  return copied;
}

// 从 HTML 抽图片 URL:og:image / link icon / <img src|srcset>,按品牌相关度排序、去重、转绝对。
function extractImageUrls(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const push = (raw, weight) => {
    if (!raw) return;
    let u;
    try { u = new URL(raw, pageUrl).href; } catch { return; }
    if (u.startsWith("data:")) return;            // 跳过内联 dataURL
    if (seen.has(u)) return;
    seen.add(u);
    out.push({ u, weight });
  };

  // 1) og:image / twitter:image —— 通常是品牌主图,最高权重
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const prop = (tag.match(/\b(?:property|name)\s*=\s*["']?([^"'>\s]+)/i) || [])[1] || "";
    if (/og:image|twitter:image/i.test(prop)) {
      const c = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
      push(c, 0);
    }
  }
  // 2) <link rel="icon"/apple-touch-icon"> —— logo/favicon
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)/i) || [])[1] || "";
    if (/icon|logo/i.test(rel)) {
      const href = (tag.match(/\bhref\s*=\s*"([^"]*)"/i) || tag.match(/\bhref\s*=\s*'([^']*)'/i) || [])[1];
      push(href, 1);
    }
  }
  // 3) <img src> —— 文件名含 logo/brand 的优先
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = (tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i) || [])[1];
    const w = src && /logo|brand|wordmark/i.test(src) ? 2 : 4;
    push(src, w);
  }
  out.sort((a, b) => a.weight - b.weight);
  // 上限 ~2×,留给下载阶段过滤格式/体积
  return out.slice(0, MAX_ASSETS * 2).map((x) => x.u);
}

function extFromUrlOrType(u, ctype) {
  let ext = "";
  try { ext = path.extname(new URL(u).pathname).slice(1).toLowerCase(); } catch {}
  if (IMG_EXTS.has(ext)) return ext === "jpeg" ? "jpg" : ext;
  if (/svg/.test(ctype)) return "svg";
  if (/png/.test(ctype)) return "png";
  if (/webp/.test(ctype)) return "webp";
  if (/jpe?g/.test(ctype)) return "jpg";
  return "";
}

function filenameFromUrl(u, ext) {
  let base = "asset";
  try {
    const p = new URL(u).pathname;
    base = path.basename(p, path.extname(p)) || "asset";
  } catch {}
  base = base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "asset";
  return `${base}.${ext}`;
}

async function safeReaddir(dir) {
  try { return await fs.readdir(dir); } catch { return []; }
}
