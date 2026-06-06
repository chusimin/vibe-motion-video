// 步骤⑦ assemble —— 把已批准的分段渲染产物拼成成片。
// 机械活:ffmpeg concat(重编码统一编码/分辨率/fps)+ BGM 混音 ducking + 响度归一 -14 LUFS。
// 产物:07_final/final.mp4。setStep('assemble','done')。
import { promises as fs } from "node:fs";
import path from "node:path";
import { FILES, DIRS } from "../lib/project.mjs";
import { UserError } from "../lib/log.mjs";
import { ensureFfmpeg, runFfmpeg, probe, sh, matchNumber } from "../lib/ffmpeg.mjs";

const TARGET_LUFS = -14;   // 短视频平台通用响度目标
const TARGET_TP = -1.5;    // 真峰值上限 dBTP
const TARGET_LRA = 11;     // 响度范围

// 解析布尔旗标(--allow-unapproved 可不带值)
function asBool(v, dflt = false) {
  if (v === undefined) return dflt;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["false", "0", "no", "off", "n"].includes(s)) return false;
  return true;
}

// 选要拼接的 chunk:优先 approved;没有 approved 但有 rendered → 需 --allow-unapproved。
function pickChunks(chunks, allowUnapproved, log) {
  const all = (chunks || []).slice().sort((a, b) => a.index - b.index);
  const approved = all.filter((c) => c.status === "approved");
  if (approved.length) return approved;

  const rendered = all.filter((c) => c.status === "rendered" || c.status === "approved");
  if (rendered.length && allowUnapproved) {
    log.warn(`没有 approved 分段,--allow-unapproved 生效:改用 ${rendered.length} 个 rendered 分段拼接(仅供测试)。`);
    return rendered;
  }
  if (rendered.length && !allowUnapproved) {
    throw new UserError(
      `有 ${rendered.length} 个分段已渲染但都未 approved。请先逐段确认(把 chunks[].status 置为 approved),` +
      `或加 --allow-unapproved 强行用 rendered 分段(仅测试)。`
    );
  }
  throw new UserError(`没有可拼接的分段(既无 approved 也无 rendered)。先完成步骤⑥分段渲染。`);
}

// 解析每个 chunk 对应的渲染文件路径,缺文件即报错。
async function resolveChunkFiles(project, chunks) {
  const files = [];
  for (const c of chunks) {
    const rel = c.renderRef || path.join(DIRS.renders, `chunk-${c.index}.mp4`);
    const abs = project.p(rel);
    try { await fs.access(abs); }
    catch { throw new UserError(`分段 ${c.index} 的渲染文件不存在:${rel}。先渲染该段。`); }
    files.push({ index: c.index, abs });
  }
  return files;
}

// ── 第一步:concat 拼接(统一重编码到 config 的分辨率/fps,h264/aac) ──
// 用 concat demuxer + list 文件;重编码以消除分段间编码参数差异,保证可拼。
async function concatChunks(project, config, files, outPath, log) {
  const { width, height } = config.resolution;
  const fps = config.fps;

  // 写 concat list(用绝对路径 + 单引号转义)
  const listPath = project.p(DIRS.final, "_concat.txt");
  const listBody = files
    .map((f) => `file '${f.abs.replace(/'/g, "'\\''")}'`)
    .join("\n") + "\n";
  await fs.writeFile(listPath, listBody, "utf8");

  // 统一:缩放并 pad 到目标分辨率(保持长宽比,letterbox),设帧率,h264 + aac。
  // setsar=1 防像素长宽比污染;-r 固定帧率;音频统一 48k 立体声。
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `setsar=1`,
    `fps=${fps}`,
  ].join(",");

  await runFfmpeg([
    "-y",
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    outPath,
  ], { label: "concat 拼接" });

  await fs.rm(listPath, { force: true });
  log.ok(`已拼接 ${files.length} 段 → ${path.relative(project.dir, outPath)}(${width}x${height}@${fps}fps, h264/aac)`);
}

// 解析 BGM 路径:--music 优先,其次 storyboard.music.track(相对 project 解析)。
async function resolveMusic(project, sb, flags) {
  let track = flags.music || sb?.music?.track || null;
  if (!track) return null;
  // 绝对路径直接用;相对路径相对 project 目录解析
  const abs = path.isAbsolute(track) ? track : project.p(track);
  try { await fs.access(abs); }
  catch { throw new UserError(`找不到背景音乐文件:${track}(解析为 ${abs})`); }
  return abs;
}

// ── 第二步:混 BGM + ducking ──
// 现有人声在 [0:a],BGM 在 [1:a]。
// sidechaincompress:用人声做 sidechain,有声时把 BGM 压低(自动 ducking)。
// 若 duckUnderVo=false,则只按 gainDb 静态压低后直接混。最后合并回视频。
async function mixMusic(project, videoIn, musicPath, musicOpt, outPath, log) {
  const gainDb = typeof musicOpt?.gainDb === "number" ? musicOpt.gainDb : -18;
  const duck = musicOpt?.duckUnderVo !== false; // 默认 true
  const gainLinear = Math.pow(10, gainDb / 20).toFixed(4);

  let filter;
  if (duck) {
    // BGM 先做 gain,人声复制一路当 sidechain key;sidechaincompress 让 BGM 在人声出现时下压。
    // threshold/ratio/attack/release 取适中值,贴合口播节奏。
    filter =
      `[1:a]volume=${gainLinear},aloop=loop=-1:size=2e9[bgm];` +
      `[0:a]asplit=2[vo][sc];` +
      `[bgm][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300:makeup=1[bgmduck];` +
      `[vo][bgmduck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;
  } else {
    // 不 ducking:BGM 静态压低后直接和人声混。
    filter =
      `[1:a]volume=${gainLinear},aloop=loop=-1:size=2e9[bgm];` +
      `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;
  }

  await runFfmpeg([
    "-y",
    "-i", videoIn,
    "-i", musicPath,
    "-filter_complex", filter,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",                 // 视频已编码好,直接拷贝
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    outPath,
  ], { label: "BGM 混音 ducking" });

  log.ok(`已混入背景音乐(gain ${gainDb}dB, ${duck ? "sidechain ducking 开" : "静态压低"})。`);
}

// ── 第三步:响度归一到 -14 LUFS(两遍 loudnorm) ──
// 第一遍 measured 模式只测量(打印 JSON);第二遍带 measured_* 做线性归一,精度更高。
// 测量失败则退化为单遍 loudnorm(仍然归一,精度略低)。
async function loudnormTwoPass(project, videoIn, outPath, log) {
  // 第一遍:测量(把视频丢到 null,只读 loudnorm 打印的 JSON)
  const measure = await sh("ffmpeg", [
    "-y", "-i", videoIn,
    "-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`,
    "-f", "null", "-",
  ]);

  let stats = null;
  // loudnorm 的 JSON 在 stderr 末尾(一个 { ... } 块)
  const m = (measure.stderr || "").match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (measure.code === 0 && m) {
    try { stats = JSON.parse(m[0]); } catch { stats = null; }
  }

  // 只接受有限数;静音音轨 measured_I 会是 "-inf",第二遍线性归一会被 ffmpeg 拒绝。
  const finiteNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const mI = finiteNum(stats?.input_i);
  const mTP = finiteNum(stats?.input_tp);
  const mLRA = finiteNum(stats?.input_lra);
  const mThresh = finiteNum(stats?.input_thresh);
  const mOffset = finiteNum(stats?.target_offset);
  const canLinear = mI !== null && mTP !== null && mLRA !== null && mThresh !== null && mOffset !== null;

  let af;
  let mode;
  if (canLinear) {
    // 第二遍:线性归一(带测量值)
    af =
      `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}` +
      `:measured_I=${mI}:measured_TP=${mTP}` +
      `:measured_LRA=${mLRA}:measured_thresh=${mThresh}` +
      `:offset=${mOffset}:linear=true:print_format=summary`;
    mode = "两遍(测量+线性归一)";
  } else {
    // 退化:单遍动态归一(测量失败,或音轨静音/极弱致 measured 非有限)
    af = `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}`;
    mode = stats ? "单遍(测量值非有限/疑似静音,退化为动态归一)" : "单遍(测量失败,退化为动态归一)";
    log.warn(`loudnorm 测量值不可用(可能音轨静音),退化为单遍归一。`);
  }

  await runFfmpeg([
    "-y", "-i", videoIn,
    "-af", af,
    "-map", "0:v", "-map", "0:a",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    outPath,
  ], { label: "响度归一 loudnorm" });

  if (mI !== null) {
    log.ok(`响度归一 ${mode}:输入 ${mI.toFixed(1)} LUFS → 目标 ${TARGET_LUFS} LUFS。`);
  } else {
    log.ok(`响度归一 ${mode} → 目标 ${TARGET_LUFS} LUFS。`);
  }
}

// 判断视频是否含音频流(没有就不能做 loudnorm/混音)
async function hasAudio(file) {
  const info = await probe(file);
  return Boolean(info.audio);
}

export default async function run(ctx) {
  const { project, flags, log } = ctx;
  await ensureFfmpeg();

  // 读 config / storyboard
  const config = await project.readJSONSafe(FILES.config);
  if (!config) throw new UserError("缺少 config.json。先完成步骤②。");
  if (!config.resolution?.width || !config.resolution?.height || !config.fps) {
    throw new UserError("config.json 缺少 resolution/fps,无法确定输出规格。");
  }
  const sb = await project.readJSONSafe(FILES.storyboard);
  if (!sb) throw new UserError("缺少 storyboard.json。先完成步骤④。");

  const allowUnapproved = asBool(flags["allow-unapproved"], false);

  // 1) 选分段 + 解析文件
  const chunks = pickChunks(sb.chunks, allowUnapproved, log);
  const files = await resolveChunkFiles(project, chunks);
  log.step("assemble", `拼接 ${files.length} 段:${chunks.map((c) => c.index).join(", ")}`);

  // 确保 07_final 存在
  await fs.mkdir(project.p(DIRS.final), { recursive: true });

  // 临时产物(逐步处理,最后落 final.mp4)
  const concatOut = project.p(DIRS.final, "_concat.mp4");
  const finalOut = project.p(DIRS.final, "final.mp4");

  // 2) concat 拼接
  await concatChunks(project, config, files, concatOut, log);

  // 拼接结果是否有音频(决定后续混音/归一)
  const concatHasAudio = await hasAudio(concatOut);
  if (!concatHasAudio) {
    log.warn("拼接结果不含音频流,跳过混音与响度归一。");
  }

  // 3) 混 BGM(可选)
  const musicPath = await resolveMusic(project, sb, flags);
  let stageIn = concatOut;
  const mixedOut = project.p(DIRS.final, "_mixed.mp4");
  if (musicPath && concatHasAudio) {
    await mixMusic(project, stageIn, musicPath, sb.music || {}, mixedOut, log);
    stageIn = mixedOut;
  } else if (musicPath && !concatHasAudio) {
    log.warn("有 BGM 但成片无人声音轨,本版跳过纯 BGM 铺底(避免无对照的响度)。");
  }

  // 4) 响度归一 → final.mp4
  if (concatHasAudio) {
    await loudnormTwoPass(project, stageIn, finalOut, log);
  } else {
    // 无音频:直接把拼接结果落为 final.mp4
    await fs.copyFile(concatOut, finalOut);
  }

  // 5) 清理临时文件
  for (const tmp of [concatOut, mixedOut]) {
    await fs.rm(tmp, { force: true });
  }

  // 6) 收尾:核对成片、置状态
  const info = await probe(finalOut);
  await project.setStep("assemble", "done");
  log.ok(
    `成片就绪:${path.relative(project.dir, finalOut)}  ` +
    `时长 ${info.durationSec.toFixed(2)}s,${info.video?.width}x${info.video?.height},` +
    `视频${info.video ? "✓" : "✗"}/音频${info.audio ? "✓" : "✗"}。`
  );
  log.dim("下一步:vibemotion qa(体检)→ vibemotion export(导出)。");
}
