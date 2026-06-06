// 步骤④· 素材需求闸门 —— `vibemotion assets`
//   扫 storyboard.scenes 的 visual.media(已指定路径)与 visual.assetReq(声明需求):
//   1) 自动绑定:在 00_input/assets/(ingest 抓的)与项目 assets/ 找匹配素材,命中写回 scene.visual.media 并存盘。
//   2) 缺口清单:仍缺的逐项打印「用途 + 规格 + 放哪 + 替代方案」。
//   3) 校验:已绑定/已放的素材用 ffprobe 核对 format/尺寸/透明/aspect,不达标 warn。
//   4) 全部「必需」素材就位 → log.ok 放行;否则 exit 非 0 + 清单。
//   支持 --scene <id> 只看某镜。
//
// 「必需」判定:一个镜头需要素材 = 它有 visual.media(脚本明确要这张图)或 visual.assetReq(声明了需求)。
// 只用真货、不编造占位:必需素材没就位则不放行(exit 1),交还用户补。
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { FILES, DIRS } from "../lib/project.mjs";
import { UserError } from "../lib/log.mjs";

// 默认替代方案(assetReq.alternatives 缺省时用)
const DEFAULT_ALTERNATIVES = [
  "你提供:把素材放到建议路径",
  "我录屏:产品页用 Playwright 自动截图/录制(screenshot/broll)",
  "库存图:从 Pexels 等图库取(photo/background)",
  "改纯动效:这个镜头不用素材,改用纯文字/图形动效",
];

// kind → 期望的文件扩展名候选(用于自动匹配与默认格式建议)
const KIND_EXTS = {
  logo: ["svg", "png", "webp"],
  icon: ["svg", "png", "webp"],
  screenshot: ["png", "jpg", "jpeg", "webp"],
  photo: ["jpg", "jpeg", "png", "webp"],
  background: ["jpg", "jpeg", "png", "webp", "mp4", "mov"],
  broll: ["mp4", "mov", "webm"],
};

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "m4v", "mkv"]);

// ── ffprobe 探测素材实际规格 ────────────────────────────────
// 返回 { width, height, hasAlpha, ext, codec, isVideo } 或 { error }。SVG 走文本兜底。
function pexecJSON(bin, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", err });
    });
  });
}

async function probeAsset(abs) {
  const ext = path.extname(abs).slice(1).toLowerCase();
  // SVG 是矢量,ffprobe 不认;读文本扒 viewBox/width/height,alpha 视为可透明。
  if (ext === "svg") {
    try {
      const txt = await fs.readFile(abs, "utf8");
      let w, h;
      const vb = txt.match(/viewBox\s*=\s*["']\s*[\d.+-]+\s+[\d.+-]+\s+([\d.+-]+)\s+([\d.+-]+)/i);
      if (vb) { w = Math.round(parseFloat(vb[1])); h = Math.round(parseFloat(vb[2])); }
      const wAttr = txt.match(/\bwidth\s*=\s*["']([\d.]+)/i);
      const hAttr = txt.match(/\bheight\s*=\s*["']([\d.]+)/i);
      if (!w && wAttr) w = Math.round(parseFloat(wAttr[1]));
      if (!h && hAttr) h = Math.round(parseFloat(hAttr[1]));
      return { ext, width: w, height: h, hasAlpha: true, isVideo: false, vector: true };
    } catch (e) {
      return { ext, error: `读取 SVG 失败:${e.message}` };
    }
  }
  // 位图/视频:ffprobe 取首个视频流的宽高/像素格式/编码
  const r = await pexecJSON("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,pix_fmt,codec_name,codec_type",
    "-of", "json", abs,
  ]);
  if (r.code !== 0) {
    return { ext, error: `ffprobe 失败(code ${r.code})${r.stderr ? ": " + r.stderr.split("\n")[0] : ""}` };
  }
  let info;
  try { info = JSON.parse(r.stdout); } catch { return { ext, error: "ffprobe 输出解析失败" }; }
  const st = (info.streams || [])[0];
  if (!st) return { ext, error: "未找到视频/图像流" };
  const pix = st.pix_fmt || "";
  // 像素格式含 a(rgba/ya/...)或 pal8(调色板可带透明)→ 视为可能有 alpha
  const hasAlpha = /a$|^ya|^rgba|^bgra|argb|abgr|pal8/i.test(pix) || /\ba\b/.test(pix);
  return {
    ext,
    width: st.width,
    height: st.height,
    hasAlpha,
    pixFmt: pix,
    codec: st.codec_name,
    isVideo: VIDEO_EXTS.has(ext) || st.codec_type === "video" && VIDEO_EXTS.has(ext),
  };
}

// ── 校验:对照 assetReq 核对实际规格,返回 { ok, issues:[] } ──
async function validateAgainstReq(abs, req) {
  const issues = [];
  const probe = await probeAsset(abs);
  if (probe.error) {
    return { ok: false, issues: [`无法读取素材规格(${probe.error})`], probe };
  }
  if (!req) {
    // 无需求声明:只做存在性 + 可读性(已通过 probe),不挑规格
    return { ok: true, issues: [], probe };
  }
  // 格式
  if (req.format) {
    const want = req.format.toLowerCase();
    const got = probe.ext;
    const jpgAlias = (a, b) => (a === "jpg" || a === "jpeg") && (b === "jpg" || b === "jpeg");
    if (got !== want && !jpgAlias(got, want)) {
      issues.push(`格式不符:要 ${want},实际 ${got}`);
    }
  }
  // 尺寸(矢量 SVG 无固定像素,跳过尺寸硬校验,仅提示)
  if (!probe.vector) {
    if (typeof req.minWidth === "number" && typeof probe.width === "number" && probe.width < req.minWidth) {
      issues.push(`宽度不足:要 ≥${req.minWidth}px,实际 ${probe.width}px`);
    }
    if (typeof req.minHeight === "number" && typeof probe.height === "number" && probe.height < req.minHeight) {
      issues.push(`高度不足:要 ≥${req.minHeight}px,实际 ${probe.height}px`);
    }
  } else if ((req.minWidth || req.minHeight) && (probe.width || probe.height)) {
    // SVG 矢量可无限缩放,只在 viewBox 明显偏小时温和提示
    if (req.minWidth && probe.width && probe.width < req.minWidth) {
      issues.push(`提示:SVG viewBox 宽 ${probe.width} < ${req.minWidth}(矢量可缩放,通常无碍)`);
    }
  }
  // 透明
  if (req.transparent === true && probe.hasAlpha === false) {
    issues.push(`需要透明通道,但素材像素格式${probe.pixFmt ? `(${probe.pixFmt})` : ""}无 alpha`);
  }
  // 画幅 aspect(允许 1% 容差)
  if (req.aspect && typeof probe.width === "number" && typeof probe.height === "number" && probe.height > 0) {
    const want = parseAspect(req.aspect);
    if (want) {
      const got = probe.width / probe.height;
      if (Math.abs(got - want) / want > 0.01) {
        issues.push(`画幅不符:要 ${req.aspect}(≈${want.toFixed(3)}),实际 ${probe.width}x${probe.height}(≈${got.toFixed(3)})`);
      }
    }
  }
  return { ok: issues.length === 0, issues, probe };
}

function parseAspect(s) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*[:x\/]\s*(\d+(?:\.\d+)?)$/i);
  if (m) { const a = parseFloat(m[1]), b = parseFloat(m[2]); return b > 0 ? a / b : null; }
  const f = parseFloat(s);
  return Number.isFinite(f) && f > 0 ? f : null;
}

// ── 自动绑定:在候选目录里找匹配素材 ───────────────────────
// 匹配优先级:① assetReq.kind 关键词(如 logo)命中文件名 ② 期望格式匹配 ③ 退而求其次按 kind 默认格式。
// 返回 project 相对路径(供写回 visual.media,render 能解析)或 null。
async function listCandidateFiles(project) {
  // 候选目录:00_input/assets(ingest 抓的)+ 项目 assets/(用户放的)
  const dirs = [
    { abs: project.p(DIRS.input, "assets"), rel: path.posix.join(DIRS.input, "assets") },
    { abs: project.p("assets"), rel: "assets" },
  ];
  const files = [];
  for (const d of dirs) {
    let names;
    try { names = await fs.readdir(d.abs, { withFileTypes: true }); } catch { continue; }
    for (const e of names) {
      if (!e.isFile()) continue;
      if (e.name.startsWith(".")) continue;
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (!IMG_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) continue;
      files.push({
        name: e.name,
        ext,
        abs: path.join(d.abs, e.name),
        rel: path.posix.join(d.rel, e.name), // project 相对、posix
        dir: d.rel,
      });
    }
  }
  return files;
}

// 给一个镜头(有 assetReq 但没 media)找最佳候选文件
function pickCandidate(scene, files) {
  const req = scene.visual.assetReq || {};
  const kind = req.kind;
  const wantFmt = req.format ? req.format.toLowerCase() : null;
  const kindExts = kind && KIND_EXTS[kind] ? KIND_EXTS[kind] : null;
  const idTokens = [scene.id].filter(Boolean).map((s) => s.toLowerCase());

  // 给每个候选打分,选最高。
  // 关键纪律:只有「有亲和信号」(文件名含 kind 关键词 / 含 scene id / logo|icon 类的通用 logo|icon 命名)
  // 的候选才有资格自动绑定 —— 格式/透明只用于排序,绝不单凭格式把一张明显不对的图(如把 logo.png 当 screenshot)硬绑上。
  // 没有任何亲和候选 → 返回 null,让它进缺口清单交还用户,不编造错绑。
  let best = null, bestScore = -1;
  for (const f of files) {
    let score = 0;
    const lname = f.name.toLowerCase();
    const baseNoExt = lname.replace(/\.[^.]+$/, "");

    // —— 亲和信号(决定是否够格绑定)——
    let affinity = false;
    if (kind && lname.includes(kind)) { score += 50; affinity = true; }       // 文件名含 kind(logo/screenshot…)
    for (const t of idTokens) {
      if (t && lname.includes(t)) { score += 20; affinity = true; }            // 文件名含 scene id
    }
    // logo/icon 类:文件名是通用 logo/icon/brand 命名也算亲和(ingest 常抓到 logo.png/favicon)
    if ((kind === "logo" || kind === "icon") && /^(logo|brand|wordmark|favicon|icon|apple-touch-icon)/.test(baseNoExt)) {
      score += 40; affinity = true;
    }

    // —— 排序信号(只在亲和候选间分高下,不单独够格)——
    if (wantFmt) {
      const jpgAlias = (a, b) => (a === "jpg" || a === "jpeg") && (b === "jpg" || b === "jpeg");
      if (f.ext === wantFmt || jpgAlias(f.ext, wantFmt)) score += 30;
      else score -= 15; // 格式不符扣分但不排除(校验阶段再提醒)
    } else if (kindExts && kindExts.includes(f.ext)) {
      score += 15;
    }
    if (req.transparent && ["png", "svg", "webp"].includes(f.ext)) score += 10;
    const wantVideo = kind === "broll" || (wantFmt && VIDEO_EXTS.has(wantFmt));
    if (wantVideo && VIDEO_EXTS.has(f.ext)) score += 25;
    if (!wantVideo && IMG_EXTS.has(f.ext)) score += 5;
    if (f.dir === "assets") score += 3; // 用户手放的 assets/ 比 ingest 抓的更可信

    // 无亲和的候选不参与竞争(格式对也不绑)
    if (!affinity) continue;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  // 兜底门槛:有亲和且分数为正才绑
  return bestScore >= 20 ? best : null;
}

// ── 缺口清单的「放哪」建议路径 ──────────────────────────────
function suggestPath(scene) {
  const req = scene.visual.assetReq || {};
  const kind = req.kind || "asset";
  let ext = req.format ? req.format.toLowerCase() : (KIND_EXTS[kind] ? KIND_EXTS[kind][0] : "png");
  return path.posix.join("assets", `${scene.id}-${kind}.${ext}`);
}

// ── 规格描述(给缺口清单) ──────────────────────────────────
function describeSpec(req) {
  const parts = [];
  if (req.format) parts.push(`格式 ${req.format}`);
  if (req.minWidth || req.minHeight) {
    parts.push(`尺寸 ≥${req.minWidth || "?"}×${req.minHeight || "?"}px`);
  }
  if (req.aspect) parts.push(`画幅 ${req.aspect}`);
  if (req.transparent) parts.push("需透明背景");
  return parts.length ? parts.join(" · ") : "(未指定具体规格)";
}

// ── 主流程 ─────────────────────────────────────────────────
export default async function run(ctx) {
  const { project, flags, log } = ctx;

  const sb = await project.readJSONSafe(FILES.storyboard);
  if (!sb) {
    throw new UserError(`找不到或无法解析 ${FILES.storyboard}。素材闸门在 storyboard 之后跑,请先写好分镜。`);
  }
  let scenes = sb.scenes || [];
  if (!scenes.length) throw new UserError("storyboard.scenes 为空,无素材可扫。");

  // --scene 过滤
  const onlyScene = flags.scene && flags.scene !== true ? String(flags.scene) : null;
  if (onlyScene) {
    scenes = scenes.filter((s) => s.id === onlyScene);
    if (!scenes.length) throw new UserError(`storyboard 里没有镜头 ${onlyScene}。`);
  }

  log.step("assets", `素材闸门${onlyScene ? `(仅 ${onlyScene})` : ""}:扫描需求 → 自动绑定 → 校验 → 出清单`);

  // 只看「需要素材」的镜头:有 visual.media 或 visual.assetReq
  const relevant = scenes.filter((s) => {
    const v = s.visual || {};
    return v.media || v.assetReq;
  });
  if (!relevant.length) {
    log.ok("没有镜头声明素材需求(无 visual.media / visual.assetReq)。本片可纯动效完成,放行。");
    return;
  }

  const candidates = await listCandidateFiles(project);
  log.dim(`候选素材池:${candidates.length} 个(扫 ${DIRS.input}/assets 与 assets/)。`);

  let bound = 0;          // 本次自动绑定数
  const gaps = [];        // 缺口镜头
  const warnings = [];    // 校验不达标
  const okList = [];      // 已就位且达标

  for (const scene of relevant) {
    const v = scene.visual;
    const req = v.assetReq || null;

    // 1) 已有 media:解析 → 存在则校验,不存在记为缺口(脚本指了一张不存在的图)
    if (v.media) {
      const abs = path.isAbsolute(v.media) ? v.media : project.p(v.media);
      let stat = null;
      try { stat = await fs.stat(abs); } catch {}
      if (stat && stat.isFile()) {
        const { ok, issues, probe } = await validateAgainstReq(abs, req);
        const dims = probe && probe.width ? `${probe.width}x${probe.height}` : (probe && probe.vector ? "矢量" : "?");
        if (ok) {
          okList.push(`${scene.id}: ${v.media}  [${probe.ext}${dims !== "?" ? " " + dims : ""}]`);
        } else {
          warnings.push({ scene: scene.id, media: v.media, issues });
        }
        continue;
      }
      // media 指向不存在的文件 → 缺口
      gaps.push({ scene, req, reason: `visual.media 指向的文件不存在:${v.media}`, suggest: v.media });
      continue;
    }

    // 2) 只有 assetReq:尝试自动绑定
    const pick = req ? pickCandidate(scene, candidates) : null;
    if (pick) {
      v.media = pick.rel;                 // 写回 project 相对路径
      bound++;
      const { ok, issues, probe } = await validateAgainstReq(pick.abs, req);
      const dims = probe && probe.width ? `${probe.width}x${probe.height}` : (probe && probe.vector ? "矢量" : "?");
      log.ok(`自动绑定 ${scene.id} ← ${pick.rel}  [${probe.ext}${dims !== "?" ? " " + dims : ""}]`);
      if (!ok) warnings.push({ scene: scene.id, media: pick.rel, issues });
      else okList.push(`${scene.id}: ${pick.rel}  (自动绑定)`);
      continue;
    }

    // 3) 仍缺
    gaps.push({ scene, req, reason: "未在素材池找到匹配素材", suggest: suggestPath(scene) });
  }

  // 绑定有变更 → 存盘
  if (bound > 0) {
    await project.writeJSON(FILES.storyboard, sb);
    log.dim(`已写回 ${bound} 处 visual.media 到 ${FILES.storyboard}。`);
  }

  // ── 校验不达标(已绑/已放但规格不符)──
  if (warnings.length) {
    log.warn(`${warnings.length} 个已就位素材规格不达标:`);
    for (const w of warnings) {
      log.raw(`  · ${w.scene}  「${w.media}」\n`);
      for (const is of w.issues) log.raw(`      - ${is}\n`);
    }
  }

  // ── 缺口清单 ──
  if (gaps.length) {
    log.warn(`仍缺 ${gaps.length} 个必需素材,逐项清单如下:`);
    gaps.forEach((g, i) => {
      const { scene, req } = g;
      const purpose = (req && req.purpose) || scene.purpose || scene.onScreenText || "(未注明用途)";
      const kind = (req && req.kind) ? req.kind : "素材";
      const alts = (req && Array.isArray(req.alternatives) && req.alternatives.length)
        ? req.alternatives : DEFAULT_ALTERNATIVES;
      log.raw(`\n  [${i + 1}] ${scene.id}  ·  ${kind}\n`);
      log.raw(`      原因:${g.reason}\n`);
      log.raw(`      用途:${purpose}\n`);
      log.raw(`      规格:${req ? describeSpec(req) : "(无 assetReq,按脚本指定路径补齐即可)"}\n`);
      log.raw(`      放哪:${g.suggest}\n`);
      log.raw(`      替代方案:\n`);
      alts.forEach((a, j) => log.raw(`        ${"①②③④⑤⑥".charAt(j) || (j + 1) + "."} ${a}\n`));
    });
  }

  // ── 放行判定 ──
  const blocked = gaps.length > 0;
  log.raw("\n");
  if (okList.length) {
    log.ok(`已就位且达标:${okList.length} 个`);
    for (const o of okList) log.dim(`  ✓ ${o}`);
  }

  if (blocked) {
    log.err(
      `素材闸门未通过:${gaps.length} 个必需素材缺口(见上)。` +
      `\n  只用真货、不编造占位 —— 请按清单补齐到建议路径,或选替代方案,然后重跑 \`vibemotion assets\` 校验。`
    );
    process.exit(1);
  }

  // 全部必需素材就位(可能有规格 warn,但不阻断;由用户判断是否够用)
  if (warnings.length) {
    log.warn("所有必需素材已就位,但有规格提醒(见上)。若可接受即可继续;要换更优素材就替换后重跑。");
  } else {
    log.ok("所有必需素材已就位且达标 —— 素材闸门放行,可进入配音/渲染。");
  }
}
