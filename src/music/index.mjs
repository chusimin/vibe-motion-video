// 步骤⑦· music —— showreel 配乐三件套:出 BGM 提示词 / 按 BPM 卡点 / 登记配乐。
//   music prompt  生成可直接投喂 Suno/Udio 的正/负向提示词(参数化 preset 模板)
//   music sync    由已知 BPM 算拍格,把 scene 边界吸附到最近拍点(卡点)
//   music set     把选好的曲子写进 storyboard.music{track,gainDb,duckUnderVo},供 assemble 混音
// 机械活(确定性):模板填充 / 拍格吸附算术 / 文件校验。创意活(选曲、调风格)由用户/agent 决定。
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILES, DIRS } from "../lib/project.mjs";
import { UserError } from "../lib/log.mjs";
import { ensureFfmpeg, sh, probe, hasBin } from "../lib/ffmpeg.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_PRESET_DIR = path.resolve(__dirname, "../../presets/audio");

// scene 吸附后允许的最小时长(秒):再短就不像一个镜头。
const MIN_SCENE_SEC = 0.4;

// ── 小工具 ──────────────────────────────────────────────

// 解析布尔旗标:支持 `--apply`(=true)、`--apply=false`、`--apply true/false`。
function asBool(v, dflt = false) {
  if (v === undefined) return dflt;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["false", "0", "no", "off", "n"].includes(s)) return false;
  if (["true", "1", "yes", "on", "y", ""].includes(s)) return true;
  return dflt;
}

function asNum(v) {
  if (v === undefined || v === true) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// 加载音频 preset:优先 presets/audio/<outputType>.json,缺则退回 showreel.json。
async function loadAudioPreset(outputType, log) {
  const tryNames = [];
  if (outputType) tryNames.push(outputType);
  if (!tryNames.includes("showreel")) tryNames.push("showreel");
  for (const name of tryNames) {
    const file = path.join(AUDIO_PRESET_DIR, `${name}.json`);
    try {
      const preset = JSON.parse(await fs.readFile(file, "utf8"));
      if (name !== outputType && outputType) {
        log?.dim?.(`没有 presets/audio/${outputType}.json,退回 showreel 音频规格。`);
      }
      return preset;
    } catch { /* 试下一个 */ }
  }
  throw new UserError(`找不到任何音频 preset(presets/audio/${tryNames.join(".json / ")}.json)。`);
}

// 读 storyboard;无则抛(配乐三件套都依赖分镜时间轴)。
async function loadStoryboard(project) {
  const sb = await project.readJSONSafe(FILES.storyboard);
  if (!sb) throw new UserError("缺少 storyboard.json。先完成步骤④(storyboard validate / plan)。");
  if (!Array.isArray(sb.scenes) || !sb.scenes.length) {
    throw new UserError("storyboard.scenes 为空,无时间轴可用于配乐/卡点。");
  }
  return sb;
}

// 分镜总时长:优先 totalDurationSec,否则 Σ durationSec。
function totalDuration(sb) {
  if (typeof sb.totalDurationSec === "number" && sb.totalDurationSec > 0) return sb.totalDurationSec;
  return (sb.scenes || []).reduce((a, s) => a + (Number(s.durationSec) || 0), 0);
}

// 取 preset.bpm.default(兼容数字/对象写法)。
function presetDefaultBpm(preset) {
  const b = preset.bpm;
  if (typeof b === "number") return b;
  if (b && typeof b.default === "number") return b.default;
  return 120;
}

// ── music prompt ───────────────────────────────────────
// 用 preset.promptTemplate 填 {duration}{bpm}{style}{variant} → 完整正向提示词。
async function cmdPrompt(ctx) {
  const { project, flags, log } = ctx;
  const config = await project.readJSONSafe(FILES.config);
  const sb = await loadStoryboard(project);
  const preset = await loadAudioPreset(config?.outputType, log);

  const dur = totalDuration(sb);
  if (!(dur > 0)) throw new UserError("分镜总时长为 0,无法生成配乐提示词。");

  // BPM:--bpm 覆盖 preset 默认。
  const bpm = asNum(flags.bpm) ?? presetDefaultBpm(preset);

  // 变体:--variant 选 preset.variants 里的某个 key(A/B/C),默认 defaultVariant。
  const variants = preset.variants || {};
  const variantKey = (flags.variant ? String(flags.variant).toUpperCase() : null) || preset.defaultVariant || Object.keys(variants)[0];
  const variantDesc = variants[variantKey];
  if (!variantDesc) {
    throw new UserError(`未知鼓点变体 "${variantKey}"。可用:${Object.keys(variants).join(", ") || "(无)"}。`);
  }

  const style = preset.style || "modern motion design soundtrack";
  const durStr = dur.toFixed(2);

  // 模板填充(允许重复占位符)。
  const tpl = preset.promptTemplate || "Create a {duration}s instrumental cue around {bpm} BPM. Style: {style}. Drums: {variant}.";
  const positive = tpl
    .replaceAll("{duration}", durStr)
    .replaceAll("{bpm}", String(bpm))
    .replaceAll("{style}", style)
    .replaceAll("{variant}", variantDesc);

  const negative = preset.negativePrompt || "no vocals, no lyrics, no copyrighted melody";
  const models = Array.isArray(preset.models) && preset.models.length ? preset.models : ["Suno", "Udio"];

  // 卡点提示:每拍秒数 + 推荐每 2/4 拍切一次。
  const beatSec = 60 / bpm;
  const cut2 = (beatSec * 2).toFixed(2);
  const cut4 = (beatSec * 4).toFixed(2);

  // 落盘:05_assets/music/bgm-prompt.txt(连负面词/模型/参数一起写,方便回看)。
  const txt = [
    `# BGM 提示词(vibemotion music prompt)`,
    `# 生成于 ${new Date().toISOString()}`,
    `# 时长 ${durStr}s · BPM ${bpm} · 变体 ${variantKey} · 风格预设 ${preset.id || config?.outputType || "showreel"}`,
    ``,
    `## 正向提示词(投喂 Suno/Udio)`,
    positive,
    ``,
    `## 负面提示词`,
    negative,
    ``,
    `## 推荐模型`,
    models.join(", "),
    ``,
    `## 卡点(随后用 vibemotion music sync --bpm ${bpm})`,
    `每拍 ${beatSec.toFixed(3)}s;建议每 2 拍(${cut2}s)或 4 拍(${cut4}s)切一次镜。`,
    ``,
  ].join("\n");
  const outRel = path.join(DIRS.music, "bgm-prompt.txt");
  await fs.mkdir(project.p(DIRS.music), { recursive: true });
  await fs.writeFile(project.p(outRel), txt, "utf8");

  // 打印
  log.step("music prompt", `BGM 提示词 · 时长 ${durStr}s · BPM ${bpm} · 变体 ${variantKey}`);
  log.raw("\n");
  log.raw("正向提示词(可直接投喂 Suno/Udio)\n");
  log.raw("────────────────────────────────────────\n");
  log.raw(positive + "\n");
  log.raw("────────────────────────────────────────\n\n");
  log.raw(`负面提示词:\n${negative}\n\n`);
  log.raw(`推荐模型:${models.join(", ")}\n`);
  log.raw(`当前 BPM/时长:${bpm} BPM · ${durStr}s · 变体 ${variantKey}(${variantDesc})\n`);
  log.raw(`卡点:每拍 ${beatSec.toFixed(3)}s;建议每 2 拍(${cut2}s)/ 4 拍(${cut4}s)切镜。\n`);
  log.ok(`已写 ${outRel}`);
  log.dim(`下一步:拿提示词去 ${models[0]}/${models[1] || "Udio"} 生成 → 放进 ${DIRS.music}/ → ` +
    `\`vibemotion music set ${DIRS.music}/<曲>.mp3\` 登记 → 可选 \`vibemotion music sync --bpm ${bpm}\` 卡点。`);
  return { positive, negative, bpm, durationSec: dur, variant: variantKey };
}

// ── music sync ─────────────────────────────────────────
// 由 BPM 算拍格(beat=60/BPM,从 offset 起),把 scene 边界吸附到最近拍点。
// --apply:把每个 scene.durationSec 吸到「整数拍」时长(使切点落拍),重算 startSec。
// --detect <track>:ffmpeg 能量包络粗估 BPM(兜底,标注"近似"),不准让用户给 --bpm。

// 找 t 最近的拍点序号(四舍五入),返回 { beatIndex, beatTime, deltaSec }。
function nearestBeat(t, offset, beatSec) {
  const k = Math.round((t - offset) / beatSec);
  const beatTime = offset + Math.max(0, k) * beatSec;
  return { beatIndex: Math.max(0, k), beatTime, deltaSec: beatTime - t };
}

async function cmdSync(ctx) {
  const { project, flags, log } = ctx;
  const config = await project.readJSONSafe(FILES.config);
  const sb = await loadStoryboard(project);

  const offset = asNum(flags.offset) ?? 0;
  const apply = asBool(flags.apply, false);

  // BPM 来源:--bpm 优先;否则 --detect 粗估;都没有则报错(不替用户瞎猜)。
  let bpm = asNum(flags.bpm);
  let bpmSource = "用户给定 --bpm";
  let approx = false;

  if (bpm === undefined && flags.detect) {
    const det = await detectBpm(project, flags.detect, log);
    bpm = det.bpm;
    approx = true;
    bpmSource = `近似检测(能量包络自相关,置信 ${det.confidence})`;
    if (!bpm) {
      throw new UserError(`未能从 ${flags.detect} 稳定估出 BPM。请改用 \`music sync --bpm <数值>\` 手动给定。`);
    }
    log.warn(`检测到约 ${bpm} BPM(置信 ${det.confidence},近似)。若卡点不准,请用 --bpm 手填准确值。`);
  }

  if (bpm === undefined) {
    throw new UserError("music sync 需要 BPM。用 `--bpm N`(推荐,和 music prompt 同值),或 `--detect <曲>` 粗估兜底。");
  }
  if (!(bpm > 0)) throw new UserError(`BPM 非法:${bpm}。`);

  const beatSec = 60 / bpm;
  const scenes = sb.scenes;
  const fps = typeof sb.fps === "number" && sb.fps > 0 ? sb.fps : null;

  log.step("music sync", `${bpm} BPM · 每拍 ${beatSec.toFixed(3)}s · offset ${offset}s · ${bpmSource}`);

  // 1) 报告:每个 scene 边界(startSec)对最近拍点的偏移。
  //    边界 = 各 scene 的起点 + 末镜的结尾(整片落幕)。
  const boundaries = [];
  for (const sc of scenes) boundaries.push({ id: sc.id, t: Number(sc.startSec) || 0, kind: "start" });
  const last = scenes[scenes.length - 1];
  boundaries.push({ id: "(end)", t: (Number(last.startSec) || 0) + (Number(last.durationSec) || 0), kind: "end" });

  log.raw("\n  scene 边界 → 最近拍点(偏移):\n");
  let maxAbs = 0, sumAbs = 0;
  for (const b of boundaries) {
    const nb = nearestBeat(b.t, offset, beatSec);
    const ad = Math.abs(nb.deltaSec);
    maxAbs = Math.max(maxAbs, ad); sumAbs += ad;
    const sign = nb.deltaSec >= 0 ? "+" : "";
    const mark = ad <= beatSec * 0.12 ? "✓落拍" : ad <= beatSec * 0.3 ? "·近拍" : "✗离拍";
    log.raw(
      `    ${String(b.id).padEnd(7)} ${b.t.toFixed(3)}s  → 拍#${String(nb.beatIndex).padStart(3)} @ ${nb.beatTime.toFixed(3)}s` +
      `  (${sign}${nb.deltaSec.toFixed(3)}s) ${mark}\n`
    );
  }
  const avgAbs = boundaries.length ? sumAbs / boundaries.length : 0;
  log.dim(`    平均偏移 ${avgAbs.toFixed(3)}s,最大 ${maxAbs.toFixed(3)}s(每拍 ${beatSec.toFixed(3)}s)。`);

  if (!apply) {
    log.dim("    (只读报告)加 --apply 把各 scene.durationSec 吸到整数拍,使切点落拍。");
    return { bpm, beatSec, offset, boundaries: boundaries.length, applied: false, approx };
  }

  // 2) --apply:把每个 scene 的"时长"吸到最近的整数拍(round),并保证 ≥ 至少 1 拍且 ≥ MIN_SCENE_SEC。
  //    然后从 offset 起累加重算 startSec —— 这样每个切点都正好落在拍格上。
  //    注:首镜 startSec 落在 offset(若 offset>0,说明前奏让出这段,startSec 仍由分镜起点决定;
  //    这里把整条时间轴贴着 offset 起算,首镜 start=offset)。
  const minBeats = Math.max(1, Math.ceil(MIN_SCENE_SEC / beatSec)); // 最少几拍
  const report = [];
  let cursor = offset;
  for (const sc of scenes) {
    const beforeDur = Number(sc.durationSec) || 0;
    const beforeStart = Number(sc.startSec) || 0;
    let beats = Math.round(beforeDur / beatSec);
    if (beats < minBeats) beats = minBeats;
    let snappedDur = beats * beatSec;
    // 帧对齐(若有 fps):吸到整帧,避免帧漂移(微调,通常 < 1 帧)。
    if (fps) snappedDur = Math.round(snappedDur * fps) / fps;
    const snappedStart = fps ? Math.round(cursor * fps) / fps : cursor;
    sc.startSec = snappedStart;
    sc.durationSec = snappedDur;
    report.push({ id: sc.id, beforeStart, beforeDur, afterStart: snappedStart, afterDur: snappedDur, beats });
    cursor = snappedStart + snappedDur;
  }
  const newTotal = fps ? Math.round(cursor * fps) / fps : cursor;
  // offset>0 时整片起点也右移了 offset:总时长按落幕-0 计。
  sb.totalDurationSec = newTotal;

  await project.writeJSON(FILES.storyboard, sb);

  log.raw("\n  吸附结果(原 → 吸附,落拍):\n");
  for (const r of report) {
    log.raw(
      `    ${String(r.id).padEnd(7)} dur ${r.beforeDur.toFixed(3)}→${r.afterDur.toFixed(3)}s` +
      ` (${r.beats}拍)  start ${r.beforeStart.toFixed(3)}→${r.afterStart.toFixed(3)}s\n`
    );
  }
  log.ok(`已把 ${report.length} 个 scene 的切点吸附到 ${bpm} BPM 拍格(总时长 → ${newTotal.toFixed(3)}s)。`);
  log.warn("时间轴已改:请复跑 `vibemotion storyboard validate` 与 `vibemotion storyboard plan`(重切分段)。");
  return { bpm, beatSec, offset, applied: true, scenes: report.length, totalDurationSec: newTotal, approx };
}

// ── music set ──────────────────────────────────────────
// 写 storyboard.music{track,gainDb,duckUnderVo}。校验文件存在(相对 project 解析)。
async function cmdSet(ctx) {
  const { project, positionals, flags, log } = ctx;
  const track = positionals[1]; // positionals[0] === "set"
  if (!track) {
    throw new UserError("用法:vibemotion music set <track> [--gain -20] [--duck]。<track> 是配乐文件(相对项目或绝对路径)。");
  }
  const sb = await loadStoryboard(project);

  // 校验文件存在(绝对路径直接用;相对路径相对 project 解析)。
  const abs = path.isAbsolute(track) ? track : project.p(track);
  try { await fs.access(abs); }
  catch { throw new UserError(`找不到配乐文件:${track}(解析为 ${abs})。先把曲子放进 ${DIRS.music}/。`); }

  // 用 ffprobe 确认是可解的音频,并报时长(对照分镜总时长,提醒长短)。
  await ensureFfmpeg();
  let trackDur = null, hasAudioStream = false;
  try {
    const info = await probe(abs);
    hasAudioStream = Boolean(info.audio);
    trackDur = Number.isFinite(info.durationSec) ? info.durationSec : null;
  } catch { /* probe 失败也允许写,但下面会提醒 */ }
  if (!hasAudioStream) log.warn(`ffprobe 没在 ${track} 里发现音频流,请确认这是音频/含音轨的文件。`);

  // 相对 project 存(assemble 的 resolveMusic 支持相对/绝对;相对更可移植)。
  let storeRef = track;
  if (path.isAbsolute(track)) {
    const rel = path.relative(project.dir, abs);
    if (!rel.startsWith("..")) storeRef = rel; // 在项目内 → 存相对路径
  }

  const gainDb = asNum(flags.gain);
  // --duck 不带值 = 开;--duck=false 关。默认沿用既有或 true。
  const prevMusic = sb.music || {};
  const duck = flags.duck === undefined ? (prevMusic.duckUnderVo ?? true) : asBool(flags.duck, true);

  const music = {
    track: storeRef,
    gainDb: gainDb !== undefined ? gainDb : (typeof prevMusic.gainDb === "number" ? prevMusic.gainDb : -18),
    duckUnderVo: duck,
  };
  sb.music = music;
  await project.writeJSON(FILES.storyboard, sb);

  log.step("music set", "登记配乐 → storyboard.music");
  log.raw(`    track       ${music.track}\n`);
  log.raw(`    gainDb      ${music.gainDb} dB\n`);
  log.raw(`    duckUnderVo ${music.duckUnderVo ? "开(人声出现时压低 BGM)" : "关(静态压低后直接混)"}\n`);
  if (trackDur !== null) {
    const sbDur = totalDuration(sb);
    const diff = trackDur - sbDur;
    const note = Math.abs(diff) <= 1 ? "≈ 等长" : diff > 0 ? `比成片长 ${diff.toFixed(1)}s(assemble 会按视频截断)` : `比成片短 ${(-diff).toFixed(1)}s(assemble 会 loop 铺满)`;
    log.dim(`    曲长 ${trackDur.toFixed(1)}s vs 分镜 ${sbDur.toFixed(1)}s — ${note}。`);
  }
  log.ok("已写入 storyboard.music;assemble 会据此混音(ducking + 响度归一 -14 LUFS)。");
  return music;
}

// ── BPM 粗估(--detect 兜底)──────────────────────────────
// 本机无 aubio/librosa。用 ffmpeg astats(metadata=1, reset=每 N 样本)取逐窗 RMS 当能量包络,
// 自相关找峰 → BPM。标注"近似",不准让用户用 --bpm。
async function detectBpm(project, track, log) {
  await ensureFfmpeg();
  const abs = path.isAbsolute(track) ? track : project.p(track);
  try { await fs.access(abs); }
  catch { throw new UserError(`找不到要检测的曲子:${track}(解析为 ${abs})。`); }

  const env = await energyEnvelope(abs);
  if (env.values.length < 8) {
    log.warn("能量包络太短,无法估 BPM。");
    return { bpm: null, confidence: 0 };
  }
  const { bpm, confidence } = estimateBpmFromEnvelope(env.values, env.hopSec);
  return { bpm, confidence };
}

// 用 astats 逐窗 RMS 做能量包络(本机无 aubio/librosa 时的兜底)。
// 链路:downmix 单声道 → asetnsamples 切定长窗(~50ms,48k 下 2400 样本)→ astats(reset=1)
//       每窗算一次 Overall RMS → ametadata=print 把 lavfi.astats.Overall.RMS_level 逐窗打到 stdout。
// 比抓 astats 人读文本稳得多(后者 reset 行为/声道块易解析错)。返回 { values:[线性RMS...], hopSec }。
async function energyEnvelope(file, { sampleRate = 48000, winSamples = 2400 } = {}) {
  const hopSec = winSamples / sampleRate;
  const r = await sh("ffmpeg", [
    "-hide_banner", "-nostats",
    "-i", file,
    "-ac", "1", "-ar", String(sampleRate),
    "-af",
    `asetnsamples=n=${winSamples}:p=0,` +
    `astats=metadata=1:reset=1:measure_perchannel=none,` +
    `ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
    "-f", "null", "-",
  ]);
  // ametadata 把 "lavfi.astats.Overall.RMS_level=<dB>" 逐帧打到 stdout(file=-)。
  const dbs = parseMetadataRms(r.stdout || "");
  const values = dbs.map((db) => (Number.isFinite(db) ? Math.pow(10, db / 20) : 0)); // dBFS → 线性
  return { values, hopSec };
}

// 解析 ametadata 打印的逐窗 RMS:每行形如 "lavfi.astats.Overall.RMS_level=-30.37"。
function parseMetadataRms(text) {
  const vals = [];
  for (const line of text.split("\n")) {
    const m = line.match(/RMS_level=\s*(-?\d+(?:\.\d+)?|-?inf|nan)/i);
    if (!m) continue;
    const raw = m[1].toLowerCase();
    const db = (raw === "-inf" || raw === "inf" || raw === "nan") ? -120 : Number(m[1]);
    vals.push(db);
  }
  return vals;
}

// 能量包络自相关估 BPM(思路同用户 build_audio_breakdown.py estimate_bpm)。
// 返回 { bpm, confidence }。
function estimateBpmFromEnvelope(values, hopSec, { minBpm = 70, maxBpm = 180 } = {}) {
  let env = values.slice();
  const n = env.length;
  if (n < 8) return { bpm: null, confidence: 0 };
  // 一阶差分取正(onset 强度),再去均值。
  const flux = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = env[i] - env[i - 1];
    flux[i] = d > 0 ? d : 0;
  }
  const mean = flux.reduce((a, b) => a + b, 0) / n;
  const e = flux.map((v) => v - mean);
  const minLag = Math.max(1, Math.floor((60 / maxBpm) / hopSec));
  const maxLag = Math.min(n - 1, Math.floor((60 / minBpm) / hopSec));
  if (maxLag <= minLag) return { bpm: null, confidence: 0 };
  let best = { score: -Infinity, bpm: null };
  let energy = 0; for (const v of e) energy += v * v;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += e[i] * e[i + lag];
    if (s > best.score) best = { score: s, bpm: 60 / (lag * hopSec) };
  }
  if (best.bpm === null) return { bpm: null, confidence: 0 };
  const confidence = energy > 0 ? Math.max(0, Math.min(1, best.score / energy)) : 0;
  return { bpm: Math.round(best.bpm * 10) / 10, confidence: Math.round(confidence * 1000) / 1000 };
}

// ── 入口 ───────────────────────────────────────────────
export default async function run(ctx) {
  const sub = ctx.positionals[0];
  switch (sub) {
    case "prompt": return void (await cmdPrompt(ctx));
    case "sync": return void (await cmdSync(ctx));
    case "set": return void (await cmdSet(ctx));
    case undefined:
      throw new UserError("music 需要子命令:prompt | sync | set。\n" +
        "  music prompt [--variant A|B|C] [--bpm N]   生成 BGM 提示词\n" +
        "  music sync --bpm N [--offset S] [--apply]   按 BPM 卡点(吸附 scene 边界)\n" +
        "  music set <track> [--gain -20] [--duck]     登记配乐到 storyboard.music");
    default:
      throw new UserError(`未知 music 子命令 "${sub}"。可用:prompt | sync | set。`);
  }
}

// 导出内部函数供 teardown 音频 pass 复用(同款能量包络+BPM 估计)。
export { energyEnvelope, estimateBpmFromEnvelope };
