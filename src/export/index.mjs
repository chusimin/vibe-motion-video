// 步骤⑧ export —— 把成片落 07_final/:final.mp4 / final.srt / final.m4a / manifest.json。
// 要求 assemble 已完成。SRT 由各 scene 的词级 captions + 该 scene 全局 startSec 偏移合并而成。
// setStep('export','done')。--aspect 多比例:本版做简单 letterbox 转比例(可选)。
import { promises as fs } from "node:fs";
import path from "node:path";
import { FILES, DIRS } from "../lib/project.mjs";
import { UserError } from "../lib/log.mjs";
import { ensureFfmpeg, runFfmpeg, probe } from "../lib/ffmpeg.mjs";

// 每行字幕大致字符数(中文按字计),超过就断行
const CHARS_PER_LINE = 14;

// 秒 → SRT 时间戳 HH:MM:SS,mmm
function srtTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(ss)},${pad(ms, 3)}`;
}

// 把一个 scene 的词级 words 切成若干字幕段(cue)。
// 策略:按累计字符数 ~CHARS_PER_LINE 攒一段;遇到句末标点也断。
// 每段时间 = 段内首词 start ~ 末词 end,再加全局偏移 offset。
function wordsToCues(words, offset, fallbackText, sceneStart, sceneDur) {
  const cues = [];
  if (Array.isArray(words) && words.length) {
    let buf = [];
    let bufLen = 0;
    const flush = () => {
      if (!buf.length) return;
      const startSec = offset + Number(buf[0].startSec ?? 0);
      const endSec = offset + Number(buf[buf.length - 1].endSec ?? buf[buf.length - 1].startSec ?? 0);
      const text = buf.map((w) => w.text).join("").trim();
      if (text) cues.push({ startSec, endSec, text });
      buf = []; bufLen = 0;
    };
    for (const w of words) {
      const t = String(w.text ?? "");
      buf.push(w);
      bufLen += t.length;
      // 句末标点或达到行长 → 断句
      if (bufLen >= CHARS_PER_LINE || /[。！？!?；;\n]$/.test(t.trim())) flush();
    }
    flush();
    return cues;
  }
  // 没有词级时间戳:整段按 scene 时间显示 fallbackText
  if (fallbackText && fallbackText.trim()) {
    cues.push({
      startSec: offset + 0,
      endSec: offset + (Number(sceneDur) || 0),
      text: fallbackText.trim(),
    });
  }
  return cues;
}

// 合并全局字幕:遍历 scenes,读各自 captions(相对时间)+ scene.startSec 偏移 → 全局 cue 列表。
// 返回 { cues, scenesWithCaptions, scenesTotal }。
async function buildGlobalCues(project, sb) {
  const scenes = sb.scenes || [];
  const cues = [];
  let withCaptions = 0;

  for (const sc of scenes) {
    const offset = Number(sc.startSec ?? 0); // 该 scene 在整片的全局起点
    // captionsRef 优先;否则按约定路径 05_assets/captions/<id>.json
    const rel = sc.captionsRef || path.join(DIRS.captions, `${sc.id}.json`);
    const cap = await project.readJSONSafe(rel);
    if (cap && (Array.isArray(cap.words) ? cap.words.length : false)) {
      withCaptions++;
      const scCues = wordsToCues(cap.words, offset, cap.text || sc.vo, sc.startSec, sc.durationSec);
      cues.push(...scCues);
    } else if (cap && cap.text) {
      // 有 caption 文件但无词级:整段铺
      withCaptions++;
      cues.push(...wordsToCues(null, offset, cap.text, sc.startSec, sc.durationSec));
    }
    // 完全没有 caption 的 scene:跳过(该段无字幕)
  }

  // 按起点排序,夹掉非法负时间,修正重叠(下一条不早于上一条 end)
  cues.sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].endSec <= cues[i].startSec) cues[i].endSec = cues[i].startSec + 0.5;
    if (i > 0 && cues[i].startSec < cues[i - 1].endSec - 1e-3) {
      // 轻微重叠:把前一条收到当前起点(避免叠字幕)
      cues[i - 1].endSec = Math.max(cues[i - 1].startSec + 0.2, cues[i].startSec);
    }
  }
  return { cues, scenesWithCaptions: withCaptions, scenesTotal: scenes.length };
}

// 按 ~CHARS_PER_LINE 给单条 cue 文本做软换行(SRT 内换行用 \n)
function wrapLine(text, width = CHARS_PER_LINE) {
  const t = text.trim();
  if (t.length <= width) return t;
  const lines = [];
  let cur = "";
  // 中文逐字、英文尽量按空格;这里简单逐字符攒,空格处优先断
  for (const ch of t) {
    cur += ch;
    if (cur.length >= width) {
      // 回退到最近空格(英文)
      const sp = cur.lastIndexOf(" ");
      if (sp > width * 0.5) { lines.push(cur.slice(0, sp).trim()); cur = cur.slice(sp + 1); }
      else { lines.push(cur.trim()); cur = ""; }
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.join("\n");
}

// cues → SRT 文本
function cuesToSrt(cues) {
  return cues.map((c, i) =>
    `${i + 1}\n${srtTime(c.startSec)} --> ${srtTime(c.endSec)}\n${wrapLine(c.text)}\n`
  ).join("\n") + "\n";
}

// ── 导出 SRT ──
async function exportSrt(project, sb, log) {
  const { cues, scenesWithCaptions, scenesTotal } = await buildGlobalCues(project, sb);
  if (!cues.length) {
    log.warn(`没有任何 scene 含字幕(0/${scenesTotal}),跳过 final.srt。`);
    return null;
  }
  const srt = cuesToSrt(cues);
  const outRel = path.join(DIRS.final, "final.srt");
  await fs.writeFile(project.p(outRel), srt, "utf8");
  log.ok(`字幕导出:${outRel}(${cues.length} 条,来自 ${scenesWithCaptions}/${scenesTotal} 个 scene,已加全局偏移)`);
  return { rel: outRel, cues: cues.length, firstStart: cues[0]?.startSec, lastEnd: cues[cues.length - 1]?.endSec };
}

// ── 抽音频 final.m4a ──
async function exportAudio(project, finalMp4, info, log) {
  if (!info.audio) {
    log.warn("成片无音频流,跳过 final.m4a。");
    return null;
  }
  const outRel = path.join(DIRS.final, "final.m4a");
  await runFfmpeg([
    "-y", "-i", finalMp4,
    "-vn", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    project.p(outRel),
  ], { label: "抽取音频 m4a" });
  log.ok(`音频导出:${outRel}`);
  return outRel;
}

// ── 多比例(可选):用 final.mp4 简单 letterbox 转成目标比例 ──
const ASPECT_MAP = { "9:16": [9, 16], "16:9": [16, 9], "1:1": [1, 1], "4:5": [4, 5] };
async function exportAspects(project, finalMp4, config, aspects, log) {
  const out = [];
  const baseW = config.resolution.width, baseH = config.resolution.height;
  for (const a of aspects) {
    const m = ASPECT_MAP[a];
    if (!m) { log.warn(`未知比例 ${a},跳过。`); continue; }
    // 以原片较长边为基准推目标分辨率(偶数对齐)
    const longEdge = Math.max(baseW, baseH);
    let w, h;
    if (m[0] >= m[1]) { w = longEdge; h = Math.round((longEdge * m[1]) / m[0]); }
    else { h = longEdge; w = Math.round((longEdge * m[0]) / m[1]); }
    w -= w % 2; h -= h % 2;
    const tag = a.replace(":", "x");
    const outRel = path.join(DIRS.final, `final-${tag}.mp4`);
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
    await runFfmpeg([
      "-y", "-i", finalMp4,
      "-vf", vf,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-movflags", "+faststart",
      project.p(outRel),
    ], { label: `转比例 ${a}` });
    out.push({ aspect: a, file: outRel, resolution: { width: w, height: h } });
    log.ok(`多比例导出:${outRel}(${w}x${h})`);
  }
  return out;
}

export default async function run(ctx) {
  const { project, flags, log } = ctx;
  await ensureFfmpeg();

  // 要求 assemble 已完成
  const state = await project.readState();
  const finalRel = path.join(DIRS.final, "final.mp4");
  const finalMp4 = project.p(finalRel);
  try { await fs.access(finalMp4); }
  catch {
    throw new UserError(`找不到成片 ${finalRel}。请先运行 vibemotion assemble(并通过 qa)。`);
  }
  if (state.steps?.assemble !== "done") {
    log.warn("assemble 步骤未标记 done,但检测到成片存在,继续导出。");
  }

  const config = await project.readJSONSafe(FILES.config);
  if (!config) throw new UserError("缺少 config.json。");
  const sb = await project.readJSONSafe(FILES.storyboard);
  if (!sb) throw new UserError("缺少 storyboard.json。");

  log.step("export", `导出成片到 ${DIRS.final}/`);

  const info = await probe(finalMp4);

  // 1) SRT(全局偏移合并)
  const srt = await exportSrt(project, sb, log);
  // 2) 音频
  const m4a = await exportAudio(project, finalMp4, info, log);
  // 3) 多比例(可选)
  let aspectOuts = [];
  const aspectFlag = flags.aspect;
  if (aspectFlag && typeof aspectFlag === "string") {
    const list = aspectFlag.split(",").map((s) => s.trim()).filter(Boolean);
    aspectOuts = await exportAspects(project, finalMp4, config, list, log);
  }

  // 4) QA 状态(若已跑过)
  const qa = await project.readJSONSafe(path.join(DIRS.final, "qa.json"));

  // 5) manifest.json —— 可复现清单
  const scenes = (sb.scenes || []).map((sc) => {
    const v = sc.visual || {};
    const entry = {
      id: sc.id,
      startSec: sc.startSec,
      durationSec: sc.durationSec,
      purpose: sc.purpose,
      visual: {
        type: v.type,
        ...(v.media ? { media: v.media } : {}),
        ...(v.motion ? { motion: v.motion } : {}),
        // 可复现字段:若 storyboard 给了 seed/prompt 就带上
        ...(v.seed !== undefined ? { seed: v.seed } : {}),
        ...(v.prompt ? { prompt: v.prompt } : {}),
      },
    };
    if (sc.vo) entry.vo = sc.vo;
    if (sc.onScreenText) entry.onScreenText = sc.onScreenText;
    if (sc.audioRef) entry.audioRef = sc.audioRef;
    entry.captionsRef = sc.captionsRef || path.join(DIRS.captions, `${sc.id}.json`);
    return entry;
  });

  // 产物文件清单(只列真实存在的)
  const artifacts = { video: finalRel };
  if (srt) artifacts.subtitles = srt.rel;
  if (m4a) artifacts.audio = m4a;
  if (aspectOuts.length) artifacts.aspects = aspectOuts;
  if (qa) artifacts.qaReport = path.join(DIRS.final, "qa.json");

  const manifest = {
    project: config.projectName || state.name || project.dir.split("/").pop(),
    slug: state.slug,
    generatedAt: new Date().toISOString(),
    config: {
      outputType: config.outputType,
      platform: config.platform,
      aspectRatio: config.aspectRatio,
      resolution: config.resolution,
      fps: config.fps,
      durationTargetSec: config.durationTargetSec,
      language: config.language,
      voiceover: config.voiceover,
      captions: config.captions,
      ...(config.style?.preset ? { stylePreset: config.style.preset } : {}),
    },
    concept: sb.concept || null,
    final: {
      durationSec: Number.isFinite(info.durationSec) ? Number(info.durationSec.toFixed(3)) : null,
      resolution: info.video ? { width: info.video.width, height: info.video.height } : null,
      hasVideo: Boolean(info.video),
      hasAudio: Boolean(info.audio),
    },
    scenes,
    chunks: (sb.chunks || []).map((c) => ({
      index: c.index, sceneIds: c.sceneIds, status: c.status,
      renderRef: c.renderRef || path.join(DIRS.renders, `chunk-${c.index}.mp4`),
    })),
    music: sb.music || null,
    artifacts,
    status: {
      render: state.steps?.render || "pending",
      assemble: state.steps?.assemble || "pending",
      qa: qa ? qa.overall : "not-run",
      export: "done",
    },
  };

  await project.writeJSON(path.join(DIRS.final, "manifest.json"), manifest);
  log.ok(`清单导出:${path.join(DIRS.final, "manifest.json")}`);

  await project.setStep("export", "done");

  // 收尾摘要
  log.raw("\n  产物清单:\n");
  for (const [k, v] of Object.entries(artifacts)) {
    if (Array.isArray(v)) { for (const a of v) log.raw(`    · ${a.file}  (${a.aspect})\n`); }
    else log.raw(`    · ${v}\n`);
  }
  log.ok(`导出完成 → ${DIRS.final}/  (时长 ${manifest.final.durationSec}s)`);
  return manifest;
}
