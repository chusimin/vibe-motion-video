// 步骤⑥ render —— 用 Remotion 把分镜 IR 渲成视频(分段/全片)。
// 机械活:读 storyboard+config+平台 safeArea → 取 chunk 的 scenes → 时移到从 0 起 →
// 把引用素材(audioRef/visual.media/媒体型 bg)拷进 remotion/public/_work/<idx>/ 用 staticFile 引用 →
// bundle()(进程内缓存,多 chunk 复用)→ selectComposition({id:VibeVideo, inputProps}) →
// renderMedia({codec:h264, outputLocation:06_renders/chunk-N.mp4}) → 更新 chunks.status/renderRef + 镜像 STATE。
//
// 用法:vibemotion render <--chunk N | --all | --full> [--force]
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia, ensureBrowser } from "@remotion/renderer";
import { FILES, DIRS } from "../lib/project.mjs";
import { UserError, log as defaultLog } from "../lib/log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// remotion 工程根(含 public/ 与 src/index.jsx)
const REMOTION_ROOT = path.resolve(__dirname, "../../remotion");
const REMOTION_ENTRY = path.join(REMOTION_ROOT, "src", "index.jsx");
const PUBLIC_DIR = path.join(REMOTION_ROOT, "public");
const WORK_DIRNAME = "_work"; // public 下的临时素材子目录(相对 staticFile 路径用)

const round = (n) => Math.round(n);

// ───────────────────────── 工具 ─────────────────────────

// 安全文件名:保留扩展名,其余非字母数字转 _。
function safeName(p) {
  const ext = path.extname(p);
  const base = path.basename(p, ext).replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "asset";
  return base + ext.toLowerCase();
}

// 解析 scene 里某个素材引用 → 绝对源路径(相对 project 解析);不存在返回 null。
async function resolveSourcePath(project, ref) {
  if (!ref || typeof ref !== "string") return null;
  // 绝对路径直接用;否则相对 project 根
  const abs = path.isAbsolute(ref) ? ref : project.p(ref);
  try { await fs.access(abs); return abs; } catch { return null; }
}

// 判断 bg 是否是 media 型(指向素材文件)而非颜色/渐变名。
function bgLooksLikeMedia(bg) {
  if (!bg || typeof bg !== "string") return false;
  const s = bg.trim();
  if (/^#|^(rgb|hsl|linear|radial|conic)/i.test(s)) return false; // 颜色/渐变
  if (/gradient|^accent|^fg$|^bg$/i.test(s)) return false;        // 命名渐变/颜色
  // 带常见媒体扩展名,或带路径分隔符且有扩展名
  return /\.(mp4|mov|webm|m4v|mkv|png|jpe?g|webp|gif|avif)(\?|$)/i.test(s);
}

// 把一个 chunk 的所有引用素材拷进 public/_work/<idx>/,并把 public 相对路径写回 scene._*Path。
// 返回该 chunk 用到的 captionsMap 片段。
async function stageChunkAssets({ project, scenes, chunkIdx, log }) {
  const destRel = path.posix.join(WORK_DIRNAME, String(chunkIdx)); // staticFile 用 posix 风格
  const destAbs = path.join(PUBLIC_DIR, WORK_DIRNAME, String(chunkIdx));
  await fs.mkdir(destAbs, { recursive: true });
  const captionsMap = {};
  const used = new Set(); // 去重已拷文件名

  // 拷一个源文件到 destAbs,返回 staticFile 相对路径(posix)。同名冲突自动加序号。
  async function copyIn(srcAbs) {
    let name = safeName(srcAbs);
    if (used.has(name)) {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      let i = 2;
      while (used.has(`${base}-${i}${ext}`)) i++;
      name = `${base}-${i}${ext}`;
    }
    used.add(name);
    await fs.copyFile(srcAbs, path.join(destAbs, name));
    return path.posix.join(destRel, name);
  }

  for (const scene of scenes) {
    const v = scene.visual || {};
    // 1) 视觉素材 visual.media
    if (v.media) {
      const src = await resolveSourcePath(project, v.media);
      if (src) scene._mediaPath = await copyIn(src);
      else log.warn(`scene ${scene.id}: 找不到 visual.media 素材「${v.media}」,该镜将用占位兜底。`);
    }
    // 2) 媒体型背景 bg
    if (bgLooksLikeMedia(scene.bg)) {
      const src = await resolveSourcePath(project, scene.bg);
      if (src) scene._bgPath = await copyIn(src);
      else log.warn(`scene ${scene.id}: 背景素材「${scene.bg}」找不到,降级为纯色背景。`);
    }
    // 3) 配音 audioRef
    if (scene.audioRef) {
      const src = await resolveSourcePath(project, scene.audioRef);
      if (src) scene._audioPath = await copyIn(src);
      else log.warn(`scene ${scene.id}: 配音「${scene.audioRef}」找不到,该镜无声。`);
    }
    // 4) 词级字幕 captionsRef(读 JSON 内容,随 inputProps 传,不进 public)
    if (scene.captionsRef) {
      const capAbs = await resolveSourcePath(project, scene.captionsRef);
      if (capAbs) {
        try {
          const cap = JSON.parse(await fs.readFile(capAbs, "utf8"));
          captionsMap[scene.id] = cap;
        } catch (e) {
          log.warn(`scene ${scene.id}: 字幕 JSON「${scene.captionsRef}」解析失败:${e.message}`);
        }
      } else {
        log.warn(`scene ${scene.id}: 字幕「${scene.captionsRef}」找不到。`);
      }
    }
  }
  return { captionsMap, destAbs };
}

// 清理 public/_work(渲染后)。容错:不存在/失败不致命。
async function cleanWork(log) {
  try {
    await fs.rm(path.join(PUBLIC_DIR, WORK_DIRNAME), { recursive: true, force: true });
  } catch (e) {
    log?.warn?.(`清理临时素材失败(可手动删 ${path.join(PUBLIC_DIR, WORK_DIRNAME)}):${e.message}`);
  }
}

// 时移:把一组 scenes 的 startSec 减去基准,使从 0 起;深拷贝避免改原对象。
function timeShiftScenes(scenes, baseSec) {
  return scenes.map((s) => ({ ...s, startSec: Math.max(0, +(s.startSec - baseSec).toFixed(6)) }));
}

// 取某 chunk 的 scenes(按 sceneIds 顺序),校验存在。
function scenesOfChunk(sb, chunk) {
  const byId = new Map(sb.scenes.map((s) => [s.id, s]));
  const list = [];
  for (const id of chunk.sceneIds) {
    const s = byId.get(id);
    if (!s) throw new UserError(`chunk ${chunk.index} 引用了不存在的 scene「${id}」。请重跑 storyboard plan。`);
    list.push(s);
  }
  return list;
}

// 单个 bundle 在一次进程内复用。
let _bundlePromise = null;
async function getServeUrl(log) {
  if (_bundlePromise) return _bundlePromise;
  log.info("打包 Remotion 工程(首次,稍候)…");
  _bundlePromise = bundle({
    entryPoint: REMOTION_ENTRY,
    publicDir: PUBLIC_DIR, // 把 public/(含已暂存的 _work)烘进 bundle
    onProgress: (p) => {
      if (p % 25 === 0 || p === 100) log.dim(`  bundle ${p}%`);
    },
  }).then((url) => {
    log.ok("bundle 完成。");
    return url;
  });
  return _bundlePromise;
}

// 渲一个 chunk(或全片伪 chunk)。assets 已暂存、scenes 已时移。
async function renderOneChunk({ project, config, safeArea, scenes, captionsMap, durSec, outPath, fps, log, label }) {
  const inputProps = {
    scenes,
    config: {
      ...config,
      _durationSec: durSec, // 精确驱动 durationInFrames
      _captionMaxChars: safeArea._maxCharsPerLine || config._captionMaxChars || 14,
    },
    safeArea,
    captionsMap,
  };

  const serveUrl = await getServeUrl(log);

  log.dim(`  选取合成 VibeVideo …`);
  const composition = await selectComposition({
    serveUrl,
    id: "VibeVideo",
    inputProps,
  });

  // 用 config 的分辨率/fps 覆盖(理论上 calculateMetadata 已算对,这里兜底强制一致)
  composition.width = config.resolution?.width || composition.width;
  composition.height = config.resolution?.height || composition.height;
  composition.fps = fps;
  composition.durationInFrames = Math.max(1, round(durSec * fps));

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  let lastPct = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
    overwrite: true,
    // 渲染进度打点(每 +5% 一次,避免刷屏)
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= lastPct + 5 || pct === 100) {
        lastPct = pct;
        log.dim(`  渲染 ${label}: ${pct}%`);
      }
    },
    // 捕获浏览器侧 console(模板里未知 type 的 warn 等)
    onBrowserLog: (entry) => {
      if (entry.type === "warn" || entry.type === "error") {
        log.warn(`  [browser] ${entry.text}`);
      }
    },
  });

  return outPath;
}

// 更新 storyboard.chunks[idx] 与 STATE.chunks 的 status/renderRef。
async function markChunkRendered(project, chunkIdx, renderRef) {
  const sb = await project.readJSON(FILES.storyboard);
  if (Array.isArray(sb.chunks)) {
    const c = sb.chunks.find((x) => x.index === chunkIdx);
    if (c) { c.status = "rendered"; c.renderRef = renderRef; }
    await project.writeJSON(FILES.storyboard, sb);
  }
  // 镜像 STATE
  const state = await project.readState();
  if (Array.isArray(state.chunks)) {
    const sc = state.chunks.find((x) => x.index === chunkIdx);
    if (sc) { sc.status = "rendered"; sc.renderRef = renderRef; }
    await project.patchState({ chunks: state.chunks });
  }
  // 所有分段都已渲染/批准 → 标记 render 步骤完成(状态机推进到 assemble)。
  const fresh = await project.readJSON(FILES.storyboard);
  if (Array.isArray(fresh.chunks) && fresh.chunks.length > 0 &&
      fresh.chunks.every((c) => c.status === "rendered" || c.status === "approved")) {
    await project.setStep("render", "done");
  }
}

// ───────────────────────── 加载 + 校验入参 ─────────────────────────
async function loadContext(project, log) {
  const sb = await project.readJSONSafe(FILES.storyboard);
  if (!sb) throw new UserError(`找不到 ${FILES.storyboard}。请先完成步骤④(storyboard validate && plan)。`);
  const config = await project.readJSONSafe(FILES.config);
  if (!config) throw new UserError(`找不到 ${FILES.config}。请先完成步骤②(config init)。`);

  const fps = config.fps || sb.fps || 30;
  if (!config.resolution?.width || !config.resolution?.height) {
    throw new UserError(`config.resolution 缺失,无法确定渲染分辨率。`);
  }

  // 平台 safeArea + 字幕每行字数:从 presets/platforms/<platform>.json 读。
  let safeArea = { top: 60, bottom: 60, left: 60, right: 60 };
  let maxCharsPerLine = 14;
  try {
    const platAbs = path.resolve(__dirname, "../../presets/platforms", `${config.platform}.json`);
    const plat = JSON.parse(await fs.readFile(platAbs, "utf8"));
    if (plat.safeArea) safeArea = plat.safeArea;
    if (plat.captions?.maxCharsPerLine) maxCharsPerLine = plat.captions.maxCharsPerLine;
  } catch {
    log.warn(`未找到平台预设 ${config.platform},使用默认安全区 ${JSON.stringify(safeArea)}。`);
  }
  safeArea = { ...safeArea, _maxCharsPerLine: maxCharsPerLine };

  return { sb, config, fps, safeArea };
}

// 准备一个 chunk:跳过判断 + 暂存素材。
// ⚠️ 必须在 bundle 之前完成所有 chunk 的暂存,否则缓存的 bundle 快照缺后续 chunk 素材(404)。
// 返回 null(跳过)或 prepared 对象,交 renderPrepared 渲染。
async function prepareChunk({ project, sb, config, fps, safeArea, chunk, force, log }) {
  const outRel = path.posix.join(DIRS.renders, `chunk-${chunk.index}.mp4`);
  const outAbs = project.p(DIRS.renders, `chunk-${chunk.index}.mp4`);

  // 已存在且非 force → 跳过(不暂存)
  try {
    await fs.access(outAbs);
    if (!force) {
      log.ok(`chunk ${chunk.index} 已存在,跳过(--force 可重渲):${outRel}`);
      return null;
    }
  } catch { /* 不存在,继续 */ }

  const sceneList = scenesOfChunk(sb, chunk);
  const shifted = timeShiftScenes(sceneList, chunk.startSec);
  const { captionsMap } = await stageChunkAssets({ project, scenes: shifted, chunkIdx: chunk.index, log });

  // chunk 时长:用 chunk.durationSec(plan 已算);兜底用末镜结尾。
  const durSec = typeof chunk.durationSec === "number" && chunk.durationSec > 0
    ? chunk.durationSec
    : shifted.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0);

  return { chunk, shifted, captionsMap, durSec, outAbs, outRel };
}

// 渲染已准备好的 chunk(素材已暂存进 public/_work)。
async function renderPrepared({ project, config, fps, safeArea, prepared, log }) {
  const { chunk, shifted, captionsMap, durSec, outAbs, outRel } = prepared;
  log.step(`render`, `chunk ${chunk.index}  [${chunk.sceneIds.join(", ")}]  ${durSec.toFixed(2)}s @ ${config.resolution.width}x${config.resolution.height} ${fps}fps`);
  await renderOneChunk({
    project, config, safeArea, scenes: shifted, captionsMap, durSec,
    outPath: outAbs, fps, log, label: `chunk ${chunk.index}`,
  });
  await markChunkRendered(project, chunk.index, outRel);
  log.ok(`chunk ${chunk.index} → ${outRel}`);
  return { skipped: false, outRel };
}

// 全片渲染(--full):整条 storyboard 当一个合成,预览/终片用。不切 chunk、不改 chunks 状态。
async function doFull({ project, sb, config, fps, safeArea, force, log }) {
  const outRel = path.posix.join(DIRS.renders, `full.mp4`);
  const outAbs = project.p(DIRS.renders, `full.mp4`);
  try {
    await fs.access(outAbs);
    if (!force) { log.ok(`full.mp4 已存在,跳过(--force 可重渲)。`); return; }
  } catch { /* 继续 */ }

  const shifted = timeShiftScenes(sb.scenes, 0); // 已从 0 起,仅深拷贝
  const { captionsMap } = await stageChunkAssets({ project, scenes: shifted, chunkIdx: "full", log });
  const durSec = typeof sb.totalDurationSec === "number" && sb.totalDurationSec > 0
    ? sb.totalDurationSec
    : shifted.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0);

  log.step("render", `--full 整片  ${shifted.length} 镜  ${durSec.toFixed(2)}s @ ${config.resolution.width}x${config.resolution.height} ${fps}fps`);
  await renderOneChunk({
    project, config, safeArea, scenes: shifted, captionsMap, durSec,
    outPath: outAbs, fps, log, label: "full",
  });
  log.ok(`整片 → ${outRel}`);
}

// ───────────────────────── 入口 ─────────────────────────
export default async function run(ctx) {
  const { project, flags, log = defaultLog } = ctx;
  const force = Boolean(flags.force);

  // 入参互斥校验
  const hasChunk = flags.chunk !== undefined && flags.chunk !== true;
  const wantAll = Boolean(flags.all);
  const wantFull = Boolean(flags.full);
  const modes = [hasChunk, wantAll, wantFull].filter(Boolean).length;
  if (modes === 0) {
    throw new UserError("render 需要指定目标:--chunk N | --all | --full。");
  }
  if (modes > 1) {
    throw new UserError("--chunk / --all / --full 三选一,不能同时给。");
  }

  const { sb, config, fps, safeArea } = await loadContext(project, log);

  // 确保渲染用的 Chromium 就绪(首次会自动下载)。
  await ensureBrowser();

  try {
    if (wantFull) {
      await doFull({ project, sb, config, fps, safeArea, force, log });
      return;
    }

    if (!Array.isArray(sb.chunks) || sb.chunks.length === 0) {
      throw new UserError(`storyboard 没有 chunks。请先运行 vibemotion storyboard plan。`);
    }

    if (wantAll) {
      log.info(`渲染全部 ${sb.chunks.length} 段…`);
      // ⚠️ 先把所有要渲的 chunk 素材全部暂存,再触发一次性 bundle 快照,最后逐段渲染。
      // 否则 bundle 在首段渲染时就缓存了 public 快照,后续段素材会 404。
      const prepared = [];
      for (const chunk of sb.chunks) {
        const p = await prepareChunk({ project, sb, config, fps, safeArea, chunk, force, log });
        if (p) prepared.push(p);
      }
      for (const p of prepared) {
        await renderPrepared({ project, config, fps, safeArea, prepared: p, log });
      }
      log.ok(`全部 ${sb.chunks.length} 段渲染完成。`);
      return;
    }

    // --chunk N
    const idx = Number(flags.chunk);
    if (!Number.isInteger(idx)) throw new UserError(`--chunk 需要整数,收到「${flags.chunk}」。`);
    const chunk = sb.chunks.find((c) => c.index === idx);
    if (!chunk) {
      const avail = sb.chunks.map((c) => c.index).join(", ");
      throw new UserError(`找不到 chunk ${idx}。可用分段:${avail}。`);
    }
    const prepared = await prepareChunk({ project, sb, config, fps, safeArea, chunk, force, log });
    if (prepared) await renderPrepared({ project, config, fps, safeArea, prepared, log });
  } catch (e) {
    // 常见错误补充排查提示
    enrichError(e);
    throw e;
  } finally {
    // 无论成败都清理临时素材(bundle 已烘进副本,删源不影响已渲产物)
    await cleanWork(log);
  }
}

// 给常见渲染错误补充人类可读的排查建议。
function enrichError(e) {
  const msg = String(e?.message || "");
  if (e instanceof UserError) return;
  if (/Could not find the browser|Chromium|chrome/i.test(msg)) {
    e.message = `渲染浏览器未就绪:${msg}\n  提示:Remotion 会自动下载 Chromium;若在离线环境,请联网后重试,或检查磁盘空间。`;
  } else if (/font|glyph/i.test(msg)) {
    e.message = `疑似字体问题:${msg}\n  提示:中文已用系统字体(PingFang SC)兜底;若仍缺字,请确认系统装有对应字体。`;
  } else if (/ENOENT|no such file|Failed to load|net::ERR/i.test(msg)) {
    e.message = `素材加载失败:${msg}\n  提示:检查 storyboard 里 audioRef/visual.media/bg 指向的文件是否存在(相对 project 根)。`;
  }
}
