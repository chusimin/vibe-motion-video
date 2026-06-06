// 步骤② config —— 把访谈结论(产出类型/平台/风格/品牌/时长/配音/字幕)结合预设,
// 生成并校验 config.json。创意活由 agent 决定参数,这里只做确定性的"预设合成 + 校验"。
import { FILES } from "../lib/project.mjs";
import { assertValid } from "../lib/validate.mjs";
import { loadPreset, listPresets } from "../lib/presets.mjs";
import { UserError } from "../lib/log.mjs";

// 产出类型 → 默认结构预设名(同名)。
const OUTPUT_TYPES = [
  "showreel",
  "product-intro",
  "knowledge-explainer",
  "knowledge-popsci",
  "talking-blogger",
];

// config schema 允许的字幕样式
const CAPTION_STYLES = ["karaoke", "block", "line", "minimal"];
// config schema 允许的 motion
const MOTIONS = ["calm", "balanced", "punchy"];

// 把平台预设里的 captions.style 收敛到 config schema 允许的枚举(预设里可能写别名)。
function normalizeCaptionStyle(style, fallback = "karaoke") {
  if (CAPTION_STYLES.includes(style)) return style;
  return fallback;
}

// 把任意时长夹到平台允许区间内,并给出提示。
function clampDuration(sec, range, log) {
  if (!Array.isArray(range) || range.length !== 2) return sec;
  const [lo, hi] = range;
  if (sec < lo) {
    log?.warn?.(`时长 ${sec}s 低于平台下限 ${lo}s,已夹到 ${lo}s。`);
    return lo;
  }
  if (sec > hi) {
    log?.warn?.(`时长 ${sec}s 超过平台上限 ${hi}s,已夹到 ${hi}s。`);
    return hi;
  }
  return sec;
}

// 解析 --vo / --captions 这类布尔旗标:支持 `--vo`(=true)、`--vo=false`、`--vo true/false/1/0`。
function asBool(v, dflt) {
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

// ───────────────────────── init ─────────────────────────
async function configInit(ctx) {
  const { project, flags, log } = ctx;

  const type = flags.type;
  if (!type) {
    throw new UserError(
      `必须指定 --type <${OUTPUT_TYPES.join("|")}>。`
    );
  }
  if (!OUTPUT_TYPES.includes(type)) {
    throw new UserError(
      `未知产出类型 "${type}"。可用:${OUTPUT_TYPES.join(", ")}。`
    );
  }

  const platform = flags.platform;
  if (!platform) {
    const avail = await listPresets("platforms");
    throw new UserError(
      `必须指定 --platform。可用平台预设:${avail.join(", ") || "(空)"}。`
    );
  }

  // 1) 加载三类预设
  const platformPreset = await loadPreset("platforms", platform); // 找不到会抛 UserError(含可用列表)
  const structurePreset = await loadPreset("structures", type);
  const styleName = flags.style || "apple-keynote";
  const stylePreset = await loadPreset("styles", styleName);

  // 2) 平台决定:画幅 / 分辨率 / fps / 字幕样式 / 响度
  const aspectRatio = platformPreset.aspectRatio;
  const resolution = {
    width: platformPreset.resolution.width,
    height: platformPreset.resolution.height,
  };
  const fps = platformPreset.fps;

  // 3) 结构预设决定:目标时长默认 / 第一个镜头时长默认
  const structureDefaultDur =
    structurePreset.defaultDurationSec ?? structurePreset.durationTargetSec ?? 30;
  const structureFirstScene = structurePreset.firstSceneSec ?? platformPreset.hookSec ?? 3;

  // 4) 时长:--duration 覆盖结构默认;再按平台区间夹取
  const wantDur = asNum(flags.duration) ?? structureDefaultDur;
  const durationTargetSec = clampDuration(wantDur, platformPreset.durationRange, log);

  // 第一个镜头时长:--first 覆盖结构默认;不得超过总时长
  let firstSceneSec = asNum(flags.first) ?? structureFirstScene;
  if (firstSceneSec >= durationTargetSec) {
    const fixed = Math.max(1, Math.min(firstSceneSec, Math.round(durationTargetSec / 2)));
    log.warn?.(`firstSceneSec ${firstSceneSec}s ≥ 总时长 ${durationTargetSec}s,已调整为 ${fixed}s。`);
    firstSceneSec = fixed;
  }

  // 5) 字幕:默认 enabled=true;样式取平台预设(收敛枚举);burnIn 取平台预设。
  const captionsEnabled = asBool(flags.captions, true);
  const platCap = platformPreset.captions || {};
  const captions = {
    enabled: captionsEnabled,
    style: normalizeCaptionStyle(platCap.style, "karaoke"),
    burnIn: typeof platCap.burnIn === "boolean" ? platCap.burnIn : false,
  };

  // 6) 配音:默认 enabled=false(--vo 未给);给了 provider 也视作启用。
  const voEnabled = asBool(flags.vo, false) || Boolean(flags.provider);
  const voiceover = { enabled: voEnabled };
  if (voEnabled) {
    voiceover.provider = flags.provider || "minimax";
    voiceover.speed = 1.0;
    // voiceId 留待步骤⑤选音色后回写
  } else {
    voiceover.provider = "none";
  }

  // 7) 风格:把风格预设映射进 config.style(palette/fonts/motion + preset 名)
  const motion = MOTIONS.includes(stylePreset.motion) ? stylePreset.motion : "balanced";
  const style = {
    preset: stylePreset.id || styleName,
    motion,
  };
  if (stylePreset.palette) style.palette = stylePreset.palette;
  if (stylePreset.fonts) style.fonts = stylePreset.fonts;

  // 8) 语言 & 项目名
  const language = flags.lang || "zh-CN";

  // 既有 config.json 里若已有 projectName/brand 等,做温和保留(覆盖式 init 但不丢品牌信息)
  const prev = await project.readJSONSafe(FILES.config);
  const state = await project.readState().catch(() => null);
  const projectName = flags.name || prev?.projectName || state?.name || project.dir.split("/").pop();

  const config = {
    projectName,
    outputType: type,
    platform,
    aspectRatio,
    resolution,
    fps,
    durationTargetSec,
    firstSceneSec,
    chunkSec: asNum(flags.chunk) ?? 15,
    language,
    style,
    voiceover,
    captions,
  };

  // 保留既有品牌信息(若上一版 config 有 brand)
  if (prev?.brand && typeof prev.brand === "object") config.brand = prev.brand;

  // 9) 校验后写盘 —— 必须通过 config schema
  await assertValid("config", config);
  await project.writeJSON(FILES.config, config);
  await project.setStep("config", "done");

  // 10) 摘要
  log.ok(`config.json 已生成:${project.p(FILES.config)}`);
  printSummary(config, { log, structurePreset, stylePreset });
  log.dim("下一步:vibemotion concept(③ 给 2-3 个方向)");
  return config;
}

// ───────────────────────── show ─────────────────────────
async function configShow(ctx) {
  const { project, log } = ctx;
  const config = await project.readJSONSafe(FILES.config);
  if (!config) {
    throw new UserError("当前项目还没有 config.json。先运行 `vibemotion config init --type ... --platform ...`。");
  }
  log.json(config);
  return config;
}

// ─────────────────────── validate ───────────────────────
async function configValidate(ctx) {
  const { project, log } = ctx;
  const config = await project.readJSONSafe(FILES.config);
  if (!config) {
    throw new UserError("当前项目还没有 config.json,无法校验。先运行 `vibemotion config init`。");
  }
  await assertValid("config", config); // 失败会抛 UserError
  await project.setStep("config", "done");
  log.ok("config.json 校验通过 ✓");
  printSummary(config, { log });
  return config;
}

// ───────────────────────── 摘要打印 ─────────────────────────
function printSummary(config, { log, structurePreset, stylePreset } = {}) {
  log.step("config", `${config.projectName}`);
  const rows = [
    ["产出类型", config.outputType],
    ["平台", config.platform],
    ["画幅", `${config.aspectRatio}  ${config.resolution.width}x${config.resolution.height} @${config.fps}fps`],
    ["目标时长", `${config.durationTargetSec}s  (首镜 ${config.firstSceneSec}s,分段 ${config.chunkSec}s)`],
    ["语言", config.language],
    ["风格", `${config.style?.preset || "-"}  motion=${config.style?.motion || "-"}`],
    ["配音", config.voiceover.enabled ? `开 (${config.voiceover.provider}${config.voiceover.voiceId ? ", " + config.voiceover.voiceId : ""})` : "关"],
    ["字幕", config.captions.enabled ? `开 (${config.captions.style}${config.captions.burnIn ? ", 硬字幕" : ", 软字幕"})` : "关"],
  ];
  if (config.brand?.name) rows.push(["品牌", config.brand.name]);
  for (const [k, v] of rows) log.raw(`    ${String(k).padEnd(8)} ${v}\n`);
  if (structurePreset?.beats?.length) {
    log.dim(`    节拍模板(${structurePreset.id}):${structurePreset.beats.map((b) => b.role).join(" → ")}`);
  }
}

// ───────────────────────── 入口 ─────────────────────────
export default async function run(ctx) {
  const sub = ctx.positionals[0];
  if (!sub || sub === "show") return void (await configShow(ctx));
  if (sub === "init") return void (await configInit(ctx));
  if (sub === "validate") return void (await configValidate(ctx));
  throw new UserError(`未知 config 子命令 "${sub}"。可用:init | show | validate。`);
}
