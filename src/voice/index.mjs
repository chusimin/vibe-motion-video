// 步骤⑤ voice —— TTS 配音 + 词级对齐 → 同步字幕。
//   vibemotion voice <list|synth|preview>
//
// 数据契约(其它模块依赖,务必严格遵守):
//   配音:05_assets/audio/<sceneId>.mp3
//   字幕:05_assets/captions/<sceneId>.json =
//     { sceneId, audioFile:"05_assets/audio/<sceneId>.mp3", durationSec, text, words:[{text,startSec,endSec}] }
//     —— words 时间相对该 scene 音频起点 0,startSec 单调不减,endSec≤durationSec。
//   处理后把 scene.audioRef / scene.captionsRef 写回 storyboard.json 对应 scene。
//
// 核心保证:字幕 words 必须来自音频真实时间(provider 自带 或 whisper 对齐),绝不手填顺序时间。
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FILES, DIRS } from "../lib/project.mjs";
import { UserError } from "../lib/log.mjs";
import {
  pickProviderId, getProvider, readCredentials, PROVIDER_IDS,
} from "../providers/tts/index.mjs";
import { alignWords } from "./align.mjs";
import { probeDurationSec } from "./media.mjs";

const DURATION_TOLERANCE = 0.15; // 音频时长 vs scene.durationSec 偏差告警阈值(秒)

// ───────────────────────── 入口 ─────────────────────────
export default async function run(ctx) {
  const sub = ctx.positionals[0];
  switch (sub) {
    case "list":    return cmdList(ctx);
    case "preview": return cmdPreview(ctx);
    case "synth":   return cmdSynth(ctx);
    case undefined: throw new UserError("voice 需要子命令:list | preview | synth。");
    default:        throw new UserError(`未知 voice 子命令 "${sub}"。可用:list | preview | synth。`);
  }
}

// 解析 provider:--provider / --mock / config.voiceover.provider。返回 { id, provider, creds, config }。
async function resolveProvider(ctx, { allowMockFlag = true } = {}) {
  const { project, flags } = ctx;
  const config = await project.readJSONSafe(FILES.config);
  const id = pickProviderId({
    flagProvider: typeof flags.provider === "string" ? flags.provider : undefined,
    mock: allowMockFlag ? Boolean(flags.mock) : false,
    configProvider: config?.voiceover?.provider,
  });
  const provider = getProvider(id);
  const creds = readCredentials(id); // 缺 key 抛友好 UserError
  return { id, provider, creds, config };
}

// ───────────────────────── list ─────────────────────────
async function cmdList(ctx) {
  const { log } = ctx;
  const { id, provider, creds } = await resolveProvider(ctx);
  log.step("voice list", `provider=${id}`);
  let voices;
  try {
    voices = await provider.listVoices(creds);
  } catch (e) {
    throw new UserError(`列音色失败(${id}):${e.message}`);
  }
  if (!voices || !voices.length) {
    log.warn("未返回任何音色。");
    return [];
  }
  for (const v of voices) {
    const extra = [v.lang, v.gender].filter(Boolean).join(", ");
    log.raw(`  ${String(v.id).padEnd(24)} ${v.name || ""}${extra ? `  (${extra})` : ""}\n`);
  }
  log.dim(`共 ${voices.length} 个音色。选定后:vibemotion voice synth --provider ${id} --voice <id> --all`);
  return voices;
}

// ───────────────────────── preview ─────────────────────────
async function cmdPreview(ctx) {
  const { flags, log } = ctx;
  const { id, provider, creds, config } = await resolveProvider(ctx);
  const voiceId = (typeof flags.voice === "string" && flags.voice) || config?.voiceover?.voiceId;
  const text = (typeof flags.text === "string" && flags.text) ||
    "这是一段配音试听,用来确认音色与语速是否合适。";
  const speed = numOr(flags.speed, config?.voiceover?.speed ?? 1);

  const outPath = path.join(os.tmpdir(), `vibemotion-preview-${id}-${Date.now()}.mp3`);
  log.step("voice preview", `provider=${id}${voiceId ? `  voice=${voiceId}` : ""}`);
  let res;
  try {
    res = await provider.synth({ ...creds, text, voiceId, speed, outPath });
  } catch (e) {
    throw new UserError(`试听合成失败(${id}):${e.message}`);
  }
  const dur = res.durationSec ?? (await probeDurationSec(res.audioPath));
  log.ok(`试听已生成:${res.audioPath}`);
  log.dim(`时长 ${dur.toFixed(2)}s · 文本「${text}」`);
  return res;
}

// ───────────────────────── synth ─────────────────────────
async function cmdSynth(ctx) {
  const { project, flags, log } = ctx;
  const { id, provider, creds, config } = await resolveProvider(ctx);

  // 读 storyboard,挑出要合成的 scene(有非空 vo)
  const sb = await project.readJSONSafe(FILES.storyboard);
  if (!sb || !Array.isArray(sb.scenes)) {
    throw new UserError(`找不到或无法解析 ${FILES.storyboard}。请先完成步骤④(storyboard)。`);
  }
  const targets = selectScenes(sb.scenes, flags);
  if (!targets.length) {
    throw new UserError(
      "没有可配音的 scene。请确认:\n" +
      "      · scene 含非空 vo 文本;\n" +
      "      · 用 --all 处理全部,或 --scene <id> 指定某一个。"
    );
  }

  // voiceId:--voice > config.voiceover.voiceId;给了 --voice 就回写 config。
  const cliVoice = typeof flags.voice === "string" && flags.voice ? flags.voice : null;
  let voiceId = cliVoice || config?.voiceover?.voiceId || undefined;
  const speed = numOr(flags.speed, config?.voiceover?.speed ?? 1);
  const language = config?.language || "zh-CN";
  const fit = Boolean(flags.fit);

  log.step("voice synth", `provider=${id}${voiceId ? `  voice=${voiceId}` : ""}  ${targets.length} 个镜头`);

  const audioDir = project.p(DIRS.audio);
  const capDir = project.p(DIRS.captions);
  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(capDir, { recursive: true });

  const suggestions = [];   // 时长偏差建议
  const methodStats = {};   // 对齐方式统计

  for (const sc of targets) {
    const text = sc.vo.trim();
    const audioRel = path.posix.join(DIRS.audio, `${sc.id}.mp3`);
    const capRel = path.posix.join(DIRS.captions, `${sc.id}.json`);
    const audioAbs = project.p(audioRel);
    const capAbs = project.p(capRel);

    log.info(`合成 ${sc.id}:「${preview(text)}」`);

    // 1) TTS 合成
    let res;
    try {
      res = await provider.synth({ ...creds, text, voiceId, speed, outPath: audioAbs });
    } catch (e) {
      throw new UserError(`合成 ${sc.id} 失败(${id}):${e.message}`);
    }
    // provider 可能回填默认 voiceId(如 mock/minimax 缺省音色)
    if (!voiceId && res.voiceId) voiceId = res.voiceId;

    // 2) 真实时长以 ffprobe 为准(provider 的 durationSec 仅作参考)
    const durationSec = round3(await probeDurationSec(audioAbs));

    // 3) 词级对齐:provider 自带 → whisper 段级比例 → 均匀兜底
    const { words, method } = await alignWords({
      text,
      audioPath: audioAbs,
      durationSec,
      providerWords: res.words,
      language,
      log,
    });
    methodStats[method] = (methodStats[method] || 0) + 1;

    // 4) 写 captions(严格契约)
    const captions = {
      sceneId: sc.id,
      audioFile: audioRel,
      durationSec,
      text,
      words,
    };
    // 自检:words 单调 & endSec≤durationSec(对齐层已保证,这里兜底夹一次)
    assertWordsSane(captions);
    await project.writeJSON(capRel, captions);

    // 5) 回写 scene 引用
    sc.audioRef = audioRel;
    sc.captionsRef = capRel;

    // 6) 时长偏差检测
    const planned = Number(sc.durationSec);
    const delta = Number.isFinite(planned) ? durationSec - planned : 0;
    if (Number.isFinite(planned) && Math.abs(delta) > DURATION_TOLERANCE) {
      suggestions.push({ id: sc.id, planned, actual: durationSec, delta });
    }

    log.ok(
      `${sc.id} ✓  音频 ${durationSec.toFixed(2)}s · ${words.length} 词 · 对齐=${method}` +
      (Number.isFinite(planned) ? ` · 计划 ${planned.toFixed(2)}s(Δ${fmtDelta(delta)})` : "")
    );
  }

  // 7) --fit:把 scene.durationSec 更新为音频真实时长(谨慎,需重跑 storyboard fix && plan)
  if (fit && suggestions.length) {
    for (const s of suggestions) {
      const sc = sb.scenes.find((x) => x.id === s.id);
      if (sc) sc.durationSec = s.actual;
    }
    log.warn(
      `--fit 已把 ${suggestions.length} 个 scene 的 durationSec 更新为音频真实时长。` +
      "时间连续性已被打破,请务必重跑:`vibemotion storyboard fix && vibemotion storyboard plan`。"
    );
  }

  // 8) 落盘 storyboard(audioRef/captionsRef + 可能的 --fit 时长)
  await project.writeJSON(FILES.storyboard, sb);

  // 9) --voice 回写 config
  if (cliVoice) {
    const cfg = config || (await project.readJSONSafe(FILES.config));
    if (cfg) {
      cfg.voiceover = cfg.voiceover || { enabled: true };
      cfg.voiceover.voiceId = cliVoice;
      if (id !== "mock") cfg.voiceover.provider = id;
      await project.writeJSON(FILES.config, cfg);
      log.dim(`已把 voiceId=${cliVoice} 回写 config.voiceover。`);
    }
  }

  // 10) 标记本步完成
  await project.setStep("voice", "done");

  // 11) 汇总
  const methodSummary = Object.entries(methodStats).map(([k, v]) => `${k}×${v}`).join(", ");
  log.ok(`配音完成:${targets.length} 个镜头,对齐方式 ${methodSummary}。captions 已写,scene 引用已回写,STATE.steps.voice=done。`);
  if (suggestions.length && !fit) {
    log.warn("以下 scene 的音频时长与计划偏差较大(未自动改 storyboard,交你决定;可加 --fit 自动对齐):");
    for (const s of suggestions) {
      log.raw(
        `    ${s.id}: 计划 ${s.planned.toFixed(2)}s → 建议 ${s.actual.toFixed(2)}s ` +
        `(Δ${fmtDelta(s.delta)})\n`
      );
    }
    log.dim("若采纳建议:改 storyboard 对应 durationSec(或加 --fit 重跑本步)后 `storyboard fix && storyboard plan`。");
  }
  return { scenes: targets.map((s) => s.id), suggestions, methodStats };
}

// ───────────────────────── helpers ─────────────────────────

// 选要配音的 scene:--scene <id> 指定单个;--all 全部有 vo 的;缺省也取全部有 vo 的(并提示)。
function selectScenes(scenes, flags) {
  const withVo = scenes.filter((s) => s && typeof s.vo === "string" && s.vo.trim());
  if (typeof flags.scene === "string" && flags.scene) {
    const ids = flags.scene.split(",").map((x) => x.trim()).filter(Boolean);
    const picked = scenes.filter((s) => ids.includes(s.id));
    const missing = ids.filter((id) => !scenes.some((s) => s.id === id));
    if (missing.length) throw new UserError(`storyboard 里找不到 scene:${missing.join(", ")}`);
    const noVo = picked.filter((s) => !(typeof s.vo === "string" && s.vo.trim()));
    if (noVo.length) {
      throw new UserError(`这些 scene 没有 vo 文本,无法配音:${noVo.map((s) => s.id).join(", ")}`);
    }
    return picked;
  }
  // --all 或缺省:全部有 vo 的
  return withVo;
}

function assertWordsSane(captions) {
  const { words, durationSec, sceneId } = captions;
  if (!Array.isArray(words) || !words.length) {
    throw new UserError(`${sceneId}: 词级时间戳为空,配音字幕生成异常。`);
  }
  let prevEnd = -Infinity;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (typeof w.startSec !== "number" || typeof w.endSec !== "number" || typeof w.text !== "string") {
      throw new UserError(`${sceneId}: words[${i}] 字段非法(需 {text,startSec,endSec})。`);
    }
    // 夹 & 单调兜底(对齐层应已保证;这里再夹一次,确保契约硬成立)
    if (w.startSec < 0) w.startSec = 0;
    if (w.startSec < prevEnd) w.startSec = prevEnd;
    if (w.endSec < w.startSec) w.endSec = w.startSec;
    if (w.endSec > durationSec) w.endSec = durationSec;
    if (w.startSec > durationSec) w.startSec = durationSec;
    prevEnd = w.endSec;
  }
}

function preview(s, n = 24) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n) + "…";
}

function numOr(v, dflt) {
  if (v === undefined || v === true) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function fmtDelta(d) {
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}s`;
}

function round3(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
