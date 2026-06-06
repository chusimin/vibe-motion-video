// ingest 公共工具:类型判别、HTML 正文提取、shell 调用、字幕解析。
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { UserError } from "../lib/log.mjs";

// rawText 截断上限(给主 agent 阅读的提炼原料,不必全文)
export const RAW_TEXT_LIMIT = 20000;

// 已知视频平台域名(命中即按 video 处理)
const VIDEO_HOSTS = [
  "youtube.com", "youtu.be", "m.youtube.com",
  "bilibili.com", "b23.tv", "b23.wtf",
  "douyin.com", "iesdouyin.com",
  "tiktok.com", "vm.tiktok.com",
];

// 文章/脚本扩展名
const ARTICLE_EXTS = new Set([".md", ".markdown", ".txt", ".text"]);
const SCRIPT_EXTS = new Set([".srt", ".vtt"]);

// --- 子进程封装:返回 { code, stdout, stderr };不抛(由调用方判定) ---
export function sh(bin, args, { cwd, timeoutMs = 1000 * 60 * 30, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        err: err || null,
      });
    });
  });
}

// 探测某个命令是否存在
export async function hasBin(bin) {
  const r = await sh("which", [bin], { timeoutMs: 5000 });
  return r.code === 0 && r.stdout.trim().length > 0;
}

// --- 类型判别 ---
// 返回 'url' | 'video' | 'code' | 'article' | 'script' | 'idea'
export async function detectType(ref, explicit) {
  const valid = ["url", "video", "code", "article", "idea", "script"];
  if (explicit) {
    if (!valid.includes(explicit)) {
      throw new UserError(`--type 只能是 ${valid.join(" / ")},收到:${explicit}`);
    }
    return explicit;
  }
  const s = (ref || "").trim();
  if (!s) throw new UserError("ingest 需要一个源:链接 / 文件 / 目录 / 一句话想法。");

  // http(s) 链接
  if (/^https?:\/\//i.test(s)) {
    if (isVideoUrl(s)) return "video";
    return "url";
  }

  // 文件系统路径(已存在)
  const stat = await statSafe(s);
  if (stat) {
    if (stat.isDirectory()) return "code";
    if (stat.isFile()) {
      const ext = path.extname(s).toLowerCase();
      if (SCRIPT_EXTS.has(ext)) return "script";
      if (ARTICLE_EXTS.has(ext)) return "article";
      // 其它已存在文件,当文章读(尽力而为)
      return "article";
    }
  }

  // 其余:纯文本想法
  return "idea";
}

export function isVideoUrl(u) {
  try {
    const host = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    return VIDEO_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

async function statSafe(p) {
  try { return await fs.stat(p); } catch { return null; }
}

// --- HTML → 标题 / meta / 正文 ---
export function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(collapse(stripTags(m[1]))) : "";
}

export function extractMetaDescription(html) {
  // 兼容 name=description / property=og:description,属性顺序任意
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    const name = (tag.match(/\b(?:name|property)\s*=\s*["']?([^"'>\s]+)/i) || [])[1] || "";
    if (/^(og:)?description$/i.test(name)) {
      const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
      if (content) return decodeEntities(collapse(content));
    }
  }
  return "";
}

// readability-lite:去 script/style/noscript/svg、去标签、压空白
export function htmlToText(html) {
  let s = html;
  // 优先抽 <body>(若有)
  const body = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) s = body[1];
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // 块级标签 → 换行,便于阅读
  s = s.replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|tr|br)\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = stripTags(s);
  s = decodeEntities(s);
  // 压缩空白:行内多空格 → 1,多空行 → 1
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

function stripTags(s) { return s.replace(/<[^>]+>/g, " "); }
function collapse(s) { return s.replace(/\s+/g, " ").trim(); }

export function decodeEntities(s) {
  if (!s) return "";
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
    ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™",
  };
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const cp = code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    const k = code.toLowerCase();
    return k in named ? named[k] : m;
  });
}

// --- VTT/SRT 字幕 → 纯文本 transcript ---
// 去时间轴/序号/标签,合并去重相邻重复行(自动字幕常见滚动重复)
export function subtitleToText(raw, ext = "vtt") {
  let lines = raw.replace(/\r/g, "").split("\n");
  const out = [];
  for (let line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^WEBVTT/i.test(t)) continue;
    if (/^(NOTE|STYLE|REGION|Kind:|Language:)/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue;                       // SRT 序号
    if (/-->/.test(t)) continue;                          // 时间轴
    // 去内联标签:<00:00:00.000><c> 词级、<c.color> 等
    let text = t.replace(/<\/?[^>]+>/g, "").trim();
    // VTT 转义
    text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push(text);
  }
  // 合并相邻重复(自动字幕逐词滚动会重复整句)
  const dedup = [];
  for (const l of out) {
    const prev = dedup[dedup.length - 1];
    if (prev === l) continue;
    // 若上一行是当前行的前缀(滚动累积),用更长的替换
    if (prev && l.startsWith(prev)) dedup[dedup.length - 1] = l;
    else if (prev && prev.startsWith(l)) continue;
    else dedup.push(l);
  }
  return dedup.join("\n").trim();
}

// 截断(保留前缀,标注省略)
export function truncate(s, limit = RAW_TEXT_LIMIT) {
  if (!s) return "";
  if (s.length <= limit) return s;
  return s.slice(0, limit) + `\n\n…(已截断,原文共 ${s.length} 字符)`;
}

export { ARTICLE_EXTS, SCRIPT_EXTS, VIDEO_HOSTS };
