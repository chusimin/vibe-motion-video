// vibemotion teardown <视频文件|目录|URL> [--out <目录>]
// 把对标视频拆成结构化镜头库,产物结构对齐用户的 build_video_breakdown.py:
//   videos.csv / shots.csv / shot_script.md / _semantic_pass.md
//   02_keyframes/<视频>/S####_{a_start,b_mid,c_end}_<tc>.jpg
//   03_contact_sheets/<视频>_contact_sheet.jpg
//   04_metadata/<视频>.json
// 机械活(确定性):场景检测切镜 + 关键帧抽取 + contact sheet + 元数据落盘。
// 创意活(语义):由 Agent 之后用 Read 看关键帧,把 visual_description / motion_tech 填实。
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { log, UserError } from "../lib/log.mjs";
import { sh, ensureFfmpeg, runFfmpeg, probe, parseFps, hasBin } from "../lib/ffmpeg.mjs";
import { energyEnvelope, estimateBpmFromEnvelope } from "../music/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_PRESET_DIR = path.resolve(__dirname, "../../presets/audio");

const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"]);
// 音频 pass 也接受纯音频文件输入。
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);
// 默认参数(与 .py 对齐:SCENE_THRESHOLD≈0.28、MIN_SHOT_DURATION=0.55)。
// 这里场景阈值默认 0.3(spec 要求 0.3),可用 --scene 覆盖。
const DEFAULTS = {
  scene: 0.3,        // 场景切点灵敏度 gt(scene,X);越小切得越碎
  minShot: 0.55,     // 最短镜头时长(秒),短于此并入上一镜
  interval: 4.0,     // 退化模式:无切点时按固定间隔切(秒)
  jpgQuality: 2,     // ffmpeg -q:v(2 = 高质量)
};

// ---- 小工具 ----

function isURL(s) {
  return /^https?:\/\//i.test(s);
}

// 文件名 → 安全 slug(去 [ID] 后缀、非字母数字转下划线),与 .py safe_slug 一致
function safeSlug(name) {
  let stem = path.basename(name, path.extname(name));
  stem = stem.replace(/\[[^\]]+\]/g, "");          // 去掉 [推文ID]/[YouTubeID]
  stem = stem.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return stem.slice(0, 70) || "video";
}

// 秒 → mm:ss.cc(与 .py seconds_to_tc 一致)
function secondsToTc(value) {
  const v = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(v / 60);
  const seconds = v - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}`;
}

// 文件名安全的 tc(冒号 → 连字符),用于关键帧文件名
function tcForFile(value) {
  return secondsToTc(value).replace(/:/g, "-");
}

// CSV 单元格转义:含逗号/引号/换行时用双引号包裹
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRows(header, rows) {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(header.map((k) => csvCell(row[k])).join(","));
  return lines.join("\n") + "\n";
}

// 时长分类(与 .py classify_duration 一致)
function classifyDuration(d) {
  if (d < 1.2) return "快切 / 转场镜头";
  if (d < 2.5) return "标准展示镜头";
  return "段落型镜头";
}

// 能量标签(与 .py energy_label 一致):节奏越快能量越高
function energyLabel(d) {
  if (d < 1.0) return "high";
  if (d < 2.2) return "medium";
  return "low";
}

// 推荐用途(与 .py best_use 一致)
function bestUse(index, total, d) {
  if (index === 1) return "开场候选 / 视觉钩子";
  if (index === total) return "收尾候选 / 落版";
  if (d < 1.2) return "节奏推进 / 转场桥接";
  return "主体展示 / 中段铺陈";
}

// 文件名 → 来源提示(与 .py source_hint 一致)
function sourceHint(filename) {
  const lower = filename.toLowerCase();
  const hints = [];
  if (lower.includes("showreel")) hints.push("showreel montage");
  if (lower.includes("chatgpt")) hints.push("AI/product concept");
  if (lower.includes("brand")) hints.push("brand system");
  if (lower.includes("client work")) hints.push("client/product work");
  if (lower.includes("motion")) hints.push("motion graphics");
  return hints.join(", ") || "motion reference";
}

// ---- 核心步骤 ----

// 场景检测:ffmpeg select='gt(scene,X)',showinfo → 从 stderr 抓 pts_time(与 .py scene_points 一致)
async function scenePoints(video, threshold) {
  const r = await sh("ffmpeg", [
    "-hide_banner",
    "-i", video,
    "-filter:v", `select='gt(scene,${threshold})',showinfo`,
    "-f", "null", "-",
  ]);
  // 注意:showinfo 写在 stderr;此处不判 r.code(ffmpeg 对 null muxer 可能非 0,但 stderr 已含切点)
  const points = new Set();
  for (const line of (r.stderr || "").split("\n")) {
    const m = line.match(/pts_time:([0-9.]+)/);
    if (m) points.add(Number(m[1]));
  }
  return [...points].sort((a, b) => a - b);
}

// 把切点合并成镜头区间,过滤过短镜头(与 .py merge_shots 一致)
function mergeShots(points, duration, minShot) {
  const cuts = [0.0, ...points.filter((p) => p > 0 && p < duration), duration];
  const shots = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end - start < minShot && shots.length) {
      shots[shots.length - 1][1] = end;   // 并入上一镜
    } else {
      shots.push([start, end]);
    }
  }
  // 末镜过短:并入倒数第二镜
  if (shots.length > 1 && shots[shots.length - 1][1] - shots[shots.length - 1][0] < minShot) {
    shots[shots.length - 2][1] = shots[shots.length - 1][1];
    shots.pop();
  }
  return shots;
}

// 退化模式:无切点时按固定间隔切片(保证哪怕单镜长片也能拆出多镜)
function intervalShots(duration, interval) {
  const shots = [];
  let t = 0;
  while (t < duration - 1e-6) {
    shots.push([t, Math.min(t + interval, duration)]);
    t += interval;
  }
  if (!shots.length) shots.push([0, duration]);
  return shots;
}

// 抽单帧:ffmpeg -ss <t> -i <video> -frames:v 1(与 .py extract_frame 一致)
async function extractFrame(video, timestamp, dest, jpgQuality) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", timestamp.toFixed(3),
    "-i", video,
    "-frames:v", "1",
    "-q:v", String(jpgQuality),
    dest,
  ], { label: "抽帧" });
}

// contact sheet:纯 ffmpeg(不依赖 PIL)。把该视频每镜的 mid 帧按文件名顺序 tile 拼成一张总览。
// 用 concat demuxer 把帧列表喂给 tile,避免 glob 顺序不稳。
async function makeContactSheet(midFrames, dest, tmpDir) {
  if (!midFrames.length) return false;
  const cols = 3;
  const rows = Math.max(1, Math.ceil(midFrames.length / cols));
  // 写一个 concat 列表文件(每帧 duration 1,顺序即 tile 顺序)
  const listPath = path.join(tmpDir, `sheet_${path.basename(dest)}.txt`);
  const lines = midFrames.map((f) => `file '${f.replace(/'/g, "'\\''")}'\nduration 1`);
  // concat demuxer 要求最后一帧再声明一次
  lines.push(`file '${midFrames[midFrames.length - 1].replace(/'/g, "'\\''")}'`);
  await fs.writeFile(listPath, lines.join("\n") + "\n", "utf8");
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // scale 每格到统一宽度后 tile;pad 用白底(对齐 .py 白色画布观感)
  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-frames:v", "1",
    "-vf", `scale=360:-1,tile=${cols}x${rows}:padding=6:margin=6:color=white`,
    "-q:v", "3",
    dest,
  ], { label: "contact sheet" });
  await fs.rm(listPath, { force: true });
  return true;
}

// 下载 URL 到临时目录(yt-dlp),返回本地文件路径
async function downloadURL(url, tmpDir) {
  if (!(await hasBin("yt-dlp"))) {
    throw new UserError("URL 输入需要 yt-dlp。请先安装:brew install yt-dlp");
  }
  log.info(`yt-dlp 下载:${url}`);
  const outTpl = path.join(tmpDir, "%(title).80s [%(id)s].%(ext)s");
  const r = await sh("yt-dlp", [
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "-o", outTpl,
    url,
  ], { timeoutMs: 1000 * 60 * 10 });
  if (r.code !== 0) {
    const tail = (r.stderr || "").trim().split("\n").slice(-8).join("\n");
    throw new UserError(`yt-dlp 下载失败:\n${tail}`);
  }
  // 取临时目录里最新的视频文件
  const entries = await fs.readdir(tmpDir);
  const vids = entries.filter((e) => VIDEO_EXTS.has(path.extname(e).toLowerCase()));
  if (!vids.length) throw new UserError("yt-dlp 下载完成但未找到视频文件。");
  const withStat = await Promise.all(
    vids.map(async (e) => ({ e, t: (await fs.stat(path.join(tmpDir, e))).mtimeMs }))
  );
  withStat.sort((a, b) => b.t - a.t);
  return path.join(tmpDir, withStat[0].e);
}

// 解析输入 → { videos:[视频文件...], audios:[纯音频文件...], cleanupTmp }。
// videos 进镜头拆解(视频 pass);videos+audios 都进音频 pass。
// 纯音频文件(.mp3/.wav/…)允许单独拆,只跑音频 pass。
async function resolveInputs(input, tmpDir) {
  if (isURL(input)) {
    const local = await downloadURL(input, tmpDir);
    return { videos: [local], audios: [], cleanupTmp: true };
  }
  const abs = path.resolve(input);
  let st;
  try { st = await fs.stat(abs); }
  catch { throw new UserError(`输入不存在:${abs}`); }
  if (st.isDirectory()) {
    const entries = (await fs.readdir(abs)).sort();
    const vids = entries.filter((e) => VIDEO_EXTS.has(path.extname(e).toLowerCase())).map((e) => path.join(abs, e));
    const auds = entries.filter((e) => AUDIO_EXTS.has(path.extname(e).toLowerCase())).map((e) => path.join(abs, e));
    if (!vids.length && !auds.length) throw new UserError(`目录里没有视频/音频文件:${abs}`);
    return { videos: vids, audios: auds, cleanupTmp: false };
  }
  const ext = path.extname(abs).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return { videos: [abs], audios: [], cleanupTmp: false };
  if (AUDIO_EXTS.has(ext)) return { videos: [], audios: [abs], cleanupTmp: false };
  throw new UserError(
    `不是支持的视频/音频文件:${abs}(视频 ${[...VIDEO_EXTS].join(" ")};音频 ${[...AUDIO_EXTS].join(" ")})`
  );
}

// ==== 音频 pass(--audio,默认开)====
// 对每个输入(视频/音频)用 ffmpeg 提 wav_48k + showwavespic 波形 png + ebur128/astats(RMS/peak/LUFS),
// BPM 用与 music 同款"能量包络自相关"粗估(拿不准留空+低置信),
// 按 presets/audio/<type>.json 模板生成 A/B/C 提示词 → 落 teardowns/<名>/audio/。
// 复用 build_audio_breakdown.py 思路,但纯 Node + ffmpeg,不依赖 librosa/aubio。

// 音频 pass 用的 preset:--audio-preset <type> 指定,缺则 showreel(目前只有 showreel)。
async function loadAudioPreset(name) {
  const tryNames = [];
  if (name) tryNames.push(name);
  if (!tryNames.includes("showreel")) tryNames.push("showreel");
  for (const n of tryNames) {
    try { return JSON.parse(await fs.readFile(path.join(AUDIO_PRESET_DIR, `${n}.json`), "utf8")); }
    catch { /* 试下一个 */ }
  }
  return null; // 没有 preset 也能跑分析,只是不出提示词。
}

// 提 wav_48k(pcm s16le 双声道)。无音频流则返回 false。
async function extractWav(src, wavPath) {
  await fs.mkdir(path.dirname(wavPath), { recursive: true });
  const r = await sh("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", src,
    "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
    wavPath,
  ]);
  if (r.code !== 0) return false;
  try { await fs.access(wavPath); return true; } catch { return false; }
}

// showwavespic 波形 png(单张总览),线性混合到单声道,亮线。
async function drawWaveform(wavPath, pngPath) {
  await fs.mkdir(path.dirname(pngPath), { recursive: true });
  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", wavPath,
    "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1400x320:colors=0x6E56F0",
    "-frames:v", "1",
    pngPath,
  ], { label: "showwavespic 波形" });
}

// 用 ebur128 取整体 LUFS(I)、LRA、真峰值;用 astats 取整体 RMS/Peak dBFS。
// 解析 stderr 的 Summary 块。失败返回 null 字段(不致命)。
async function loudnessStats(wavPath) {
  const out = { lufsI: null, lra: null, truePeak: null, rmsDb: null, peakDb: null };

  // ebur128:Summary 里有 "I: -xx.x LUFS"、"LRA: x.x LU"、"Peak: -x.x dBFS"(true peak)。
  const eb = await sh("ffmpeg", [
    "-hide_banner", "-nostats",
    "-i", wavPath,
    "-af", "ebur128=peak=true",
    "-f", "null", "-",
  ]);
  const ebTxt = eb.stderr || "";
  // 取 Summary 段(最后一段);整体 I/LRA/真峰
  const mI = ebTxt.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
  if (mI && mI.length) {
    const last = mI[mI.length - 1].match(/(-?\d+(?:\.\d+)?)/);
    if (last) out.lufsI = Number(last[1]);
  }
  const mLRA = ebTxt.match(/LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/g);
  if (mLRA && mLRA.length) {
    const last = mLRA[mLRA.length - 1].match(/(-?\d+(?:\.\d+)?)/);
    if (last) out.lra = Number(last[1]);
  }
  const mTP = ebTxt.match(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g);
  if (mTP && mTP.length) {
    const last = mTP[mTP.length - 1].match(/(-?\d+(?:\.\d+)?)/);
    if (last) out.truePeak = Number(last[1]);
  }

  // astats(整体):Overall 块的 RMS level dB / Peak level dB。
  const as = await sh("ffmpeg", [
    "-hide_banner", "-nostats",
    "-i", wavPath,
    "-af", "astats=metadata=0",
    "-f", "null", "-",
  ]);
  const asTxt = as.stderr || "";
  // Overall 块在末尾;取 Overall 之后的 RMS/Peak。
  const overallIdx = asTxt.lastIndexOf("Overall");
  const tail = overallIdx >= 0 ? asTxt.slice(overallIdx) : asTxt;
  const rms = tail.match(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/);
  if (rms) out.rmsDb = Number(rms[1]);
  const pk = tail.match(/Peak level dB:\s*(-?\d+(?:\.\d+)?)/);
  if (pk) out.peakDb = Number(pk[1]);

  return out;
}

// 检测 hit(粗略 onset 时间):能量包络上局部峰且超 mean+1.35σ,间隔 ≥120ms。
function detectHits(values, hopSec) {
  if (!values.length) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const threshold = mean + 1.35 * std;
  const minGap = Math.max(1, Math.round(0.12 / hopSec));
  const hits = [];
  let last = -1e9;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const prev = values[Math.max(0, i - 1)];
    const next = values[Math.min(values.length - 1, i + 1)];
    if (v >= threshold && v >= prev && v >= next && i - last >= minGap) {
      hits.push(i * hopSec);
      last = i;
    }
  }
  return hits;
}

// 按 preset.promptTemplate 生成 A/B/C 提示词(填 duration/bpm/style/variant)。
// preset 缺失或缺模板时返回 null。
function buildVariantPrompts(preset, { durationSec, bpm }) {
  if (!preset || !preset.promptTemplate || !preset.variants) return null;
  const durStr = durationSec.toFixed(2);
  const bpmVal = bpm || preset.bpm?.default || 120;
  const style = preset.style || "modern motion design soundtrack";
  const out = {};
  for (const [key, desc] of Object.entries(preset.variants)) {
    out[key] = preset.promptTemplate
      .replaceAll("{duration}", durStr)
      .replaceAll("{bpm}", String(bpmVal))
      .replaceAll("{style}", style)
      .replaceAll("{variant}", desc);
  }
  return out;
}

// 对单个输入做完整音频分析,返回一行记录(供 csv/md)。无音频流返回 null。
async function analyzeOneAudio(src, audioDir, idx, preset) {
  const fileName = path.basename(src);
  const slug = `${String(idx).padStart(2, "0")}_${safeSlug(fileName)}`;
  const wavPath = path.join(audioDir, "wav_48k", `${slug}.wav`);
  const pngPath = path.join(audioDir, "waveforms", `${slug}_waveform.png`);

  // 1) 提 wav(无音频流 → 跳过该输入)
  const ok = await extractWav(src, wavPath);
  if (!ok) return null;

  // 2) 时长 / 原始编码(ffprobe)
  let durationSec = 0, codec = "", sampleRate = 0, channels = 0;
  try {
    const info = await probe(wavPath);
    durationSec = Number.isFinite(info.durationSec) ? info.durationSec : 0;
  } catch { /* 用包络估时长兜底 */ }
  try {
    const srcInfo = await probe(src);
    if (srcInfo.audio) {
      codec = srcInfo.audio.codec_name || "";
      sampleRate = Number(srcInfo.audio.sample_rate) || 0;
      channels = Number(srcInfo.audio.channels) || 0;
    }
  } catch { /* 非致命 */ }

  // 3) 波形 png(失败不致命)
  let waveformRel = "";
  try { await drawWaveform(wavPath, pngPath); waveformRel = path.relative(audioDir, pngPath); }
  catch (e) { log.warn(`  波形生成失败(跳过):${e.message}`); }

  // 4) 响度(ebur128 + astats)
  const loud = await loudnessStats(wavPath);

  // 5) 能量包络 → BPM 粗估 + hits(与 music 同款)
  const env = await energyEnvelope(wavPath);
  if (!durationSec && env.values.length) durationSec = env.values.length * env.hopSec;
  const { bpm, confidence } = env.values.length >= 8
    ? estimateBpmFromEnvelope(env.values, env.hopSec)
    : { bpm: null, confidence: 0 };
  const hits = detectHits(env.values, env.hopSec);
  const hitDensity = durationSec > 0 ? hits.length / durationSec : 0;

  // 6) A/B/C 提示词
  const prompts = buildVariantPrompts(preset, { durationSec, bpm });

  return {
    slug,
    audio_id: `A${String(idx).padStart(2, "0")}`,
    source_file: fileName,
    duration_sec: durationSec.toFixed(2),
    codec_original: codec,
    sample_rate_original: sampleRate || "",
    channels: channels || "",
    wav_48k: path.relative(audioDir, wavPath),
    waveform: waveformRel,
    lufs_i: loud.lufsI !== null ? loud.lufsI.toFixed(1) : "",
    lra: loud.lra !== null ? loud.lra.toFixed(1) : "",
    true_peak_dbfs: loud.truePeak !== null ? loud.truePeak.toFixed(1) : "",
    rms_dbfs: loud.rmsDb !== null ? loud.rmsDb.toFixed(1) : "",
    peak_dbfs: loud.peakDb !== null ? loud.peakDb.toFixed(1) : "",
    estimated_bpm: bpm ?? "",
    bpm_confidence: confidence,
    detected_hit_count: hits.length,
    hit_density_per_sec: hitDensity.toFixed(2),
    hit_times_first_20: hits.slice(0, 20).map((t) => secondsToTc(t)).join(", "),
    prompts, // {A,B,C} 或 null,只进 md
  };
}

// 音频 pass 主函数:对所有输入跑分析 → 落 audio_analysis.csv + audio_prompts.md。
async function runAudioPass(inputs, outDir, presetName) {
  const audioDir = path.join(outDir, "audio");
  for (const sub of ["wav_48k", "waveforms"]) {
    await fs.mkdir(path.join(audioDir, sub), { recursive: true });
  }
  const preset = await loadAudioPreset(presetName);
  log.step("音频 pass", `分析 ${inputs.length} 个输入 → audio/(preset: ${preset?.id || "无,仅指标"})`);

  const rows = [];
  for (let i = 0; i < inputs.length; i++) {
    const src = inputs[i];
    log.info(`  A${String(i + 1).padStart(2, "0")} ${path.basename(src)} — 提 wav / 波形 / 响度 / BPM…`);
    let row = null;
    try { row = await analyzeOneAudio(src, audioDir, i + 1, preset); }
    catch (e) { log.warn(`  音频分析失败(跳过):${e.message}`); }
    if (!row) { log.dim(`    无音频流或分析失败,跳过。`); continue; }
    rows.push(row);
    const bpmTxt = row.estimated_bpm ? `${row.estimated_bpm} BPM(置信 ${row.bpm_confidence})` : "BPM 未稳定";
    log.dim(`    ${row.duration_sec}s · ${bpmTxt} · RMS ${row.rms_dbfs || "?"} dBFS · LUFS ${row.lufs_i || "?"} · ${row.detected_hit_count} hits`);
  }

  if (!rows.length) {
    log.warn("没有任何输入含可分析音频,跳过音频产物。");
    return { count: 0 };
  }

  // audio_analysis.csv(不含 prompts 大文本列)
  const csvHeader = [
    "audio_id", "source_file", "duration_sec", "codec_original", "sample_rate_original", "channels",
    "wav_48k", "waveform",
    "lufs_i", "lra", "true_peak_dbfs", "rms_dbfs", "peak_dbfs",
    "estimated_bpm", "bpm_confidence", "detected_hit_count", "hit_density_per_sec", "hit_times_first_20",
  ];
  await fs.writeFile(path.join(audioDir, "audio_analysis.csv"), csvRows(csvHeader, rows), "utf8");

  // audio_prompts.md(A/B/C 提示词 + 指标摘要)
  const md = [
    "# Audio 拆解与重制提示词",
    "",
    "目标:保留原音频的 motion design / tech brand / showreel 氛围,只改鼓点律动。先试听 `wav_48k/`,再选 A/B/C 一版投喂 audio 模型(Suno/Udio/…)。",
    "",
    preset ? `负面提示词:${preset.negativePrompt || "(无)"}` : "(无 preset,未生成提示词,仅指标)",
    "",
  ];
  for (const row of rows) {
    md.push(
      `## ${row.audio_id}｜${row.source_file}`,
      "",
      `- 时长:${row.duration_sec}s`,
      `- BPM 粗估:${row.estimated_bpm || "未稳定识别"}(置信 ${row.bpm_confidence})`,
      `- 响度:LUFS-I ${row.lufs_i || "?"} · RMS ${row.rms_dbfs || "?"} dBFS · 真峰 ${row.true_peak_dbfs || "?"} dBFS`,
      `- 拍点密度:${row.hit_density_per_sec}/s(${row.detected_hit_count} hits);前若干拍:${row.hit_times_first_20 || "(无)"}`,
      `- 波形图:\`${row.waveform || "(生成失败)"}\``,
      "",
    );
    if (row.prompts) {
      for (const [k, v] of Object.entries(row.prompts)) {
        md.push(`### Prompt ${k}`, v, "");
      }
    }
  }
  await fs.writeFile(path.join(audioDir, "audio_prompts.md"), md.join("\n"), "utf8");

  log.ok(`音频 pass 完成:${rows.length} 条 → audio/audio_analysis.csv + audio_prompts.md`);
  return { count: rows.length, audioDir };
}

// ---- 主流程 ----

export default async function teardown(ctx) {
  const { flags, positionals } = ctx;
  const input = positionals[0];
  if (!input) {
    throw new UserError("用法:vibemotion teardown <视频/音频文件|目录|URL> [--out <目录>] [--scene 0.3] [--interval 4] [--no-audio]");
  }

  await ensureFfmpeg();

  const scene = Number(flags.scene ?? DEFAULTS.scene);
  const minShot = Number(flags["min-shot"] ?? DEFAULTS.minShot);
  const interval = Number(flags.interval ?? DEFAULTS.interval);
  const jpgQuality = Number(flags.q ?? DEFAULTS.jpgQuality);
  // 音频 pass 默认开;--no-audio / --audio=false 关闭。
  const audioOn = !(flags["no-audio"] === true || String(flags.audio).toLowerCase() === "false");
  const audioPresetName = typeof flags["audio-preset"] === "string" ? flags["audio-preset"] : null;

  // 临时目录(URL 下载用),最后清理
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibemotion-td-"));

  let videos, audios, cleanupTmp;
  try {
    ({ videos, audios, cleanupTmp } = await resolveInputs(input, tmpDir));
  } catch (e) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw e;
  }

  // 输出目录:--out 优先;缺省 ./teardowns/<首个输入名>/(在 cwd,不往 skill 里塞二进制)
  const outName = safeSlug(videos[0] || audios[0]);
  const outDir = path.resolve(flags.out || path.join(process.cwd(), "teardowns", outName));
  for (const sub of ["02_keyframes", "03_contact_sheets", "04_metadata"]) {
    await fs.mkdir(path.join(outDir, sub), { recursive: true });
  }

  log.step("teardown", `拆解 ${videos.length} 视频${audios.length ? ` + ${audios.length} 音频` : ""} → ${outDir}`);
  log.dim(`场景阈值 scene>${scene} · 最短镜头 ${minShot}s · 退化间隔 ${interval}s · 音频 pass ${audioOn ? "开" : "关"}`);

  const videoRows = [];   // videos.csv
  const shotRows = [];    // shots.csv
  let globalIndex = 1;

  for (let vi = 0; vi < videos.length; vi++) {
    const video = videos[vi];
    const fileName = path.basename(video);
    const videoId = `V${String(vi + 1).padStart(2, "0")}`;
    const slug = `${String(vi + 1).padStart(2, "0")}_${safeSlug(fileName)}`;

    // 1) 探测元数据
    const pr = await probe(video);
    const v = pr.video || {};
    const fpsStr = v.avg_frame_rate && v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : (v.r_frame_rate || "");
    const meta = {
      video_id: videoId,
      file: fileName,
      duration: Number(pr.durationSec || 0).toFixed(3),
      width: v.width ?? "",
      height: v.height ?? "",
      fps: fpsStr,
      codec: v.codec_name ?? "",
      source_hint: sourceHint(fileName),
    };
    videoRows.push(meta);
    await fs.writeFile(
      path.join(outDir, "04_metadata", `${slug}.json`),
      JSON.stringify({ file: fileName, fps_num: parseFps(fpsStr), ...meta }, null, 2) + "\n",
      "utf8",
    );

    // 2) 场景检测切镜(退化:固定间隔)
    log.info(`${videoId} ${fileName} — 检测切点…`);
    const points = await scenePoints(video, scene);
    let shots = mergeShots(points, pr.durationSec, minShot);
    let cutMode = "scene-cut";
    if (shots.length <= 1 && pr.durationSec > interval * 1.5) {
      // 整片只有一镜但时长不短 → 退化按固定间隔切,方便后续挑帧
      shots = intervalShots(pr.durationSec, interval);
      cutMode = "fixed-interval";
    }
    log.dim(`  切点 ${points.length} 个 → ${shots.length} 镜(${cutMode})`);

    // 3) 每镜抽 3 帧 + 收集 mid 帧给 contact sheet
    const shotDir = path.join(outDir, "02_keyframes", slug);
    await fs.mkdir(shotDir, { recursive: true });
    const midFrames = [];

    for (let li = 0; li < shots.length; li++) {
      const [start, end] = shots[li];
      const dur = end - start;
      const shotId = `S${String(globalIndex).padStart(4, "0")}`;
      // 采样点:首帧略让 0.12s、正中、尾帧略提前(与 .py sample_times 一致)
      const sampleTimes = [
        start + Math.min(0.12, dur * 0.12),
        start + dur * 0.5,
        Math.max(start, end - Math.min(0.12, dur * 0.12)),
      ];
      const labels = ["a_start", "b_mid", "c_end"];
      const frameRel = [];
      for (let k = 0; k < 3; k++) {
        const fname = `${shotId}_${labels[k]}_${tcForFile(sampleTimes[k])}.jpg`;
        const fabs = path.join(shotDir, fname);
        await extractFrame(video, sampleTimes[k], fabs, jpgQuality);
        frameRel.push(path.join("02_keyframes", slug, fname));
      }
      midFrames.push(path.join(shotDir, path.basename(frameRel[1])));

      shotRows.push({
        shot_id: shotId,
        video_id: videoId,
        source_file: fileName,
        local_shot: li + 1,
        start_sec: start.toFixed(3),
        end_sec: end.toFixed(3),
        duration_sec: dur.toFixed(3),
        start_tc: secondsToTc(start),
        end_tc: secondsToTc(end),
        keyframe_start: frameRel[0],
        keyframe_mid: frameRel[1],
        keyframe_end: frameRel[2],
        shot_type: classifyDuration(dur),
        energy: energyLabel(dur),
        best_use: bestUse(li + 1, shots.length, dur),
        visual_description_draft: `${sourceHint(fileName)} 片段,第 ${li + 1} 个镜头;待复核:结合关键帧确认主体、构图、品牌元素。`,
        motion_tech_draft: `${cutMode} detected;待复核:看关键帧标注 typography/UI/3D/camera/mask/glow/particle 等技术。`,
        transition_in: "待复核",
        transition_out: "待复核",
      });
      globalIndex++;
    }

    // 4) contact sheet(每视频一张)
    const sheetPath = path.join(outDir, "03_contact_sheets", `${slug}_contact_sheet.jpg`);
    try {
      const ok = await makeContactSheet(midFrames, sheetPath, tmpDir);
      if (ok) log.dim(`  contact sheet → 03_contact_sheets/${path.basename(sheetPath)}`);
    } catch (e) {
      log.warn(`  contact sheet 生成失败(跳过):${e.message}`);
    }
  }

  // 视频 pass 产物(videos.csv / shots.csv / shot_script.md / _semantic_pass.md)只在有视频时写。
  // 纯音频输入只跑音频 pass,不产空镜头表。
  if (videos.length) {
  // 5) 写 videos.csv / shots.csv
  const videoHeader = ["video_id", "file", "duration", "width", "height", "fps", "codec", "source_hint"];
  // shots.csv 列序严格对齐 spec(后几列 transition 留占位"待复核")
  const shotHeader = [
    "shot_id", "video_id", "source_file", "local_shot",
    "start_sec", "end_sec", "duration_sec", "start_tc", "end_tc",
    "keyframe_start", "keyframe_mid", "keyframe_end",
    "shot_type", "energy", "best_use",
    "visual_description_draft", "motion_tech_draft",
    "transition_in", "transition_out",
  ];
  await fs.writeFile(path.join(outDir, "videos.csv"), csvRows(videoHeader, videoRows), "utf8");
  await fs.writeFile(path.join(outDir, "shots.csv"), csvRows(shotHeader, shotRows), "utf8");

  // 6) shot_script.md(按视频分组,逐镜列描述/节奏/技术/用途/关键帧)
  const md = [
    "# 镜头脚本拆解初稿",
    "",
    "说明:这是基于 scene-cut 检测与关键帧抽取生成的第一版镜头库。`visual_description_draft` 与 `motion_tech_draft` 是复核入口,建议结合 `02_keyframes/` 与 `03_contact_sheets/` 二次精修。",
    "",
  ];
  let currentVideo = null;
  for (const row of shotRows) {
    if (currentVideo !== row.source_file) {
      currentVideo = row.source_file;
      md.push(`## ${row.video_id}｜${currentVideo}`, "");
    }
    md.push(
      `### ${row.shot_id}｜${row.start_tc} - ${row.end_tc}｜${row.duration_sec}s`,
      `- 画面描述:${row.visual_description_draft}`,
      `- 运动/节奏:${row.shot_type},能量 ${row.energy}。`,
      `- 特效技术:${row.motion_tech_draft}`,
      `- 推荐用途:${row.best_use}`,
      `- 关键帧:\`${row.keyframe_start}\` / \`${row.keyframe_mid}\` / \`${row.keyframe_end}\``,
      "",
    );
  }
  await fs.writeFile(path.join(outDir, "shot_script.md"), md.join("\n"), "utf8");

  // 7) _semantic_pass.md —— 语义 pass 待填模板(列出所有关键帧路径,按镜分组)
  const sem = [
    "# 语义复核待填模板(semantic pass)",
    "",
    "下一步由 Agent 执行:用 **Read 工具**逐张看下面的关键帧,把每镜的 `视觉描述 / 运动技术 / 为什么高级` 填实,",
    "再把成果写进 `docs/types/<类型>.md` 与 `references/teardowns/<名>/`。",
    "",
    "填写要点:",
    "- 视觉描述:主体是什么、构图、配色、品牌/文字元素。",
    "- 运动技术:用到的手法(kinetic type / 3D logo / camera dolly / mask wipe / glow / particle / liquid morph / glitch / chromatic aberration …)。",
    "- 为什么高级:这镜的「火花」在哪——节奏、对比、信息密度、转场巧思。",
    "",
  ];
  currentVideo = null;
  for (const row of shotRows) {
    if (currentVideo !== row.source_file) {
      currentVideo = row.source_file;
      sem.push(`## ${row.video_id}｜${currentVideo}`, "");
    }
    sem.push(
      `### ${row.shot_id}｜${row.start_tc} - ${row.end_tc}｜${row.duration_sec}s｜能量 ${row.energy}｜${row.best_use}`,
      `- 关键帧 start:\`${row.keyframe_start}\``,
      `- 关键帧 mid  :\`${row.keyframe_mid}\``,
      `- 关键帧 end  :\`${row.keyframe_end}\``,
      "- [ ] 视觉描述:",
      "- [ ] 运动技术:",
      "- [ ] 为什么高级:",
      "",
    );
  }
  await fs.writeFile(path.join(outDir, "_semantic_pass.md"), sem.join("\n"), "utf8");
  } // end if (videos.length) —— 视频 pass 产物

  // 8) 音频 pass(默认开):对所有输入(视频+纯音频)提 wav/波形/响度/BPM,出 A/B/C 提示词。
  let audioResult = { count: 0 };
  if (audioOn) {
    const audioInputs = [...videos, ...audios];
    if (audioInputs.length) {
      try { audioResult = await runAudioPass(audioInputs, outDir, audioPresetName); }
      catch (e) { log.warn(`音频 pass 失败(不影响视频产物):${e.message}`); }
    }
  }

  // 清理 URL 临时下载(及 contact sheet 列表残留)
  await fs.rm(tmpDir, { recursive: true, force: true });

  // 收尾汇报
  log.ok(`完成:${videos.length} 个视频(${shotRows.length} 个镜头)${audioResult.count ? ` + ${audioResult.count} 条音频` : ""}。`);
  log.raw("\n产物:\n");
  if (videos.length) {
    log.raw(`  ${path.join(outDir, "videos.csv")}\n`);
    log.raw(`  ${path.join(outDir, "shots.csv")}\n`);
    log.raw(`  ${path.join(outDir, "shot_script.md")}\n`);
    log.raw(`  ${path.join(outDir, "_semantic_pass.md")}\n`);
    log.raw(`  ${path.join(outDir, "02_keyframes")}/  (每镜 3 帧)\n`);
    log.raw(`  ${path.join(outDir, "03_contact_sheets")}/  (每视频 1 张总览)\n`);
  }
  if (audioResult.count) {
    log.raw(`  ${path.join(outDir, "audio", "audio_analysis.csv")}\n`);
    log.raw(`  ${path.join(outDir, "audio", "audio_prompts.md")}\n`);
    log.raw(`  ${path.join(outDir, "audio", "wav_48k")}/  (每条 48k wav)\n`);
    log.raw(`  ${path.join(outDir, "audio", "waveforms")}/  (每条波形 png)\n`);
  }
  if (videos.length) log.raw(`  ${path.join(outDir, "04_metadata")}/  (逐视频 JSON)\n`);
  log.raw("\n");
  if (videos.length) {
    log.step("下一步", "语义复核 pass");
    log.dim("让 Agent 用 Read 工具看 02_keyframes/ 各帧,把 visual_description / motion_tech / 为什么高级 填实,");
    log.dim(`照 ${path.join(outDir, "_semantic_pass.md")} 模板填写,`);
    log.dim("成果写进 docs/types/<类型>.md 与 references/teardowns/<名>/。");
  }
  if (audioResult.count) {
    log.step("音频", "复用拆解");
    log.dim(`试听 audio/wav_48k/,看 audio/audio_prompts.md 的 A/B/C,选一版去 Suno/Udio 重制;`);
    log.dim("卡点用 `vibemotion music sync --bpm <CSV 里的 estimated_bpm>`。");
  }
}
