// 步骤⑦ qa —— 对 07_final/final.mp4 体检,出报告(07_final/qa.json + 人类可读摘要)。
// 每项 红/黄/绿。有红项 exit 非 0(便于 agent 定位修复)。
// 检查:时长 vs 目标、分辨率、fps、含视频+音频流、画面(全黑/冻结)、音频(非静音 + 响度 ~ -14 LUFS)。
import { promises as fs } from "node:fs";
import path from "node:path";
import { FILES, DIRS } from "../lib/project.mjs";
import { UserError } from "../lib/log.mjs";
import { ensureFfmpeg, sh, probe, parseFps, matchNumber } from "../lib/ffmpeg.mjs";

const TARGET_LUFS = -14;

// 单项检查结果:level ∈ green|yellow|red
function item(name, level, detail, extra = {}) {
  return { name, level, detail, ...extra };
}

// ── 容器/流检查(ffprobe) ──
function checkContainer(info, config) {
  const items = [];

  // 1) 时长 vs config.durationTargetSec(±0.5 绿, ±2 黄, 更大红)
  const target = Number(config.durationTargetSec);
  const dur = info.durationSec;
  if (!Number.isFinite(dur)) {
    items.push(item("时长", "red", "无法读取成片时长"));
  } else if (!Number.isFinite(target)) {
    items.push(item("时长", "yellow", `成片 ${dur.toFixed(2)}s(config 无 durationTargetSec,跳过对比)`, { value: dur }));
  } else {
    const diff = Math.abs(dur - target);
    const level = diff <= 0.5 ? "green" : diff <= 2 ? "yellow" : "red";
    items.push(item("时长", level,
      `成片 ${dur.toFixed(2)}s vs 目标 ${target}s(差 ${diff.toFixed(2)}s)`,
      { value: dur, target, diff }));
  }

  // 2) 分辨率 == config
  if (!info.video) {
    items.push(item("分辨率", "red", "无视频流"));
  } else {
    const w = info.video.width, h = info.video.height;
    const okW = w === config.resolution?.width, okH = h === config.resolution?.height;
    const level = okW && okH ? "green" : "red";
    items.push(item("分辨率", level,
      `${w}x${h} vs config ${config.resolution?.width}x${config.resolution?.height}`,
      { width: w, height: h }));
  }

  // 3) fps 接近 config.fps(±0.5 绿,否则黄)
  if (!info.video) {
    items.push(item("帧率", "red", "无视频流"));
  } else {
    const fps = parseFps(info.video.avg_frame_rate || info.video.r_frame_rate);
    const want = Number(config.fps);
    const diff = Math.abs(fps - want);
    const level = diff <= 0.5 ? "green" : diff <= 2 ? "yellow" : "red";
    items.push(item("帧率", level, `${fps.toFixed(2)}fps vs config ${want}fps`, { fps }));
  }

  // 4) 含视频 + 音频流
  items.push(item("视频流", info.video ? "green" : "red", info.video ? `${info.video.codec_name}` : "缺失"));
  items.push(item("音频流", info.audio ? "green" : "red", info.audio ? `${info.audio.codec_name}` : "缺失(成片应有音轨)"));

  return items;
}

// ── 画面检查:全黑 / 冻结 ──
// blackdetect 找全黑区间;signalstats 看整体平均亮度(过低≈黑);
// freezedetect 找冻结(画面长时间不变)。抽 ~5 帧落盘供人工复核。
async function checkVisual(project, file, durationSec) {
  const items = [];

  // blackdetect + freezedetect 一遍过(都打到 stderr)
  const r = await sh("ffmpeg", [
    "-i", file,
    "-vf", "blackdetect=d=0.5:pic_th=0.98,freezedetect=n=0.001:d=0.5",
    "-an", "-f", "null", "-",
  ]);
  const err = r.stderr || "";

  // 全黑区间:解析 black_start/black_end,累加黑时长
  let blackTotal = 0;
  const blackRe = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  let bm;
  while ((bm = blackRe.exec(err)) !== null) {
    blackTotal += Math.max(0, Number(bm[2]) - Number(bm[1]));
  }
  // 末尾可能只有 black_start 没 black_end(黑到结尾)
  const lastStart = matchNumber(err.split("black_end").pop() || "", /black_start:([\d.]+)/);
  if (lastStart !== null && Number.isFinite(durationSec)) {
    blackTotal += Math.max(0, durationSec - lastStart);
  }
  {
    const ratio = Number.isFinite(durationSec) && durationSec > 0 ? blackTotal / durationSec : 0;
    // 全片大面积黑 → 红;少量(如开场转场)→ 黄;无 → 绿
    const level = ratio >= 0.5 ? "red" : blackTotal > 0.6 ? "yellow" : "green";
    items.push(item("画面非全黑", level,
      blackTotal > 0 ? `检测到全黑累计 ${blackTotal.toFixed(2)}s(占 ${(ratio * 100).toFixed(0)}%)` : "未检测到全黑帧",
      { blackSec: Number(blackTotal.toFixed(3)) }));
  }

  // 冻结:freezedetect 报 freeze_start/freeze_end
  let freezeTotal = 0;
  const freezeRe = /freeze_start:\s*([\d.]+)[\s\S]*?freeze_end:\s*([\d.]+)/g;
  let fm;
  while ((fm = freezeRe.exec(err)) !== null) {
    freezeTotal += Math.max(0, Number(fm[2]) - Number(fm[1]));
  }
  {
    const ratio = Number.isFinite(durationSec) && durationSec > 0 ? freezeTotal / durationSec : 0;
    // 整片冻结(静态卡)→ 红;局部冻结 → 黄;无 → 绿。
    // 注意:纯色测试片会被判冻结,这是预期(真实成片有动效)。
    const level = ratio >= 0.9 ? "red" : freezeTotal > 1 ? "yellow" : "green";
    items.push(item("画面非冻结", level,
      freezeTotal > 0 ? `检测到冻结累计 ${freezeTotal.toFixed(2)}s(占 ${(ratio * 100).toFixed(0)}%)` : "未检测到长时间冻结",
      { freezeSec: Number(freezeTotal.toFixed(3)) }));
  }

  // 抽 ~5 帧供人工复核(落 07_final/qa-frames/)
  const framesDir = project.p(DIRS.final, "qa-frames");
  await fs.mkdir(framesDir, { recursive: true });
  // 清旧帧
  for (const f of await fs.readdir(framesDir).catch(() => [])) {
    if (/^frame-\d+\.jpg$/.test(f)) await fs.rm(path.join(framesDir, f), { force: true });
  }
  const n = 5;
  const okDur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 5;
  const shotPaths = [];
  for (let i = 0; i < n; i++) {
    // 均匀取样,避开最末帧
    const t = (okDur * (i + 0.5)) / n;
    const out = path.join(framesDir, `frame-${i}.jpg`);
    const fr = await sh("ffmpeg", ["-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-q:v", "3", out]);
    if (fr.code === 0) shotPaths.push(path.relative(project.dir, out));
  }
  items.push(item("抽帧采样", shotPaths.length >= n ? "green" : shotPaths.length > 0 ? "yellow" : "red",
    `抽取 ${shotPaths.length}/${n} 帧到 ${path.relative(project.dir, framesDir)}`,
    { frames: shotPaths }));

  return items;
}

// ── 音频检查:非静音 + 响度 ~ -14 LUFS ──
async function checkAudio(info, file) {
  const items = [];
  if (!info.audio) {
    items.push(item("音频非静音", "red", "无音频流"));
    items.push(item("响度(LUFS)", "red", "无音频流"));
    return items;
  }

  // 1) volumedetect:mean/max volume(全静音时 max≈-91dB)
  const vd = await sh("ffmpeg", ["-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"]);
  const meanV = matchNumber(vd.stderr, /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  const maxV = matchNumber(vd.stderr, /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  {
    // max_volume 接近 -91dB ⇒ 数字静音;mean 极低也可疑
    const silent = (maxV !== null && maxV <= -60);
    const level = silent ? "red" : (meanV !== null && meanV <= -50 ? "yellow" : "green");
    items.push(item("音频非静音", level,
      `mean ${meanV ?? "?"}dB / max ${maxV ?? "?"}dB`,
      { meanVolumeDb: meanV, maxVolumeDb: maxV }));
  }

  // 2) 实测综合响度:ebur128 取末尾 I(Integrated)
  const eb = await sh("ffmpeg", ["-i", file, "-af", "ebur128=framelog=verbose", "-vn", "-f", "null", "-"]);
  // ebur128 末尾 Summary 里有 "I:  -xx.x LUFS";取最后一个匹配
  let integrated = null;
  const matches = [...(eb.stderr || "").matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  if (matches.length) integrated = Number(matches[matches.length - 1][1]);
  {
    if (integrated === null) {
      items.push(item("响度(LUFS)", "yellow", "未能解析 ebur128 综合响度", { integratedLufs: null }));
    } else {
      const diff = Math.abs(integrated - TARGET_LUFS);
      // ±1 绿, ±3 黄, 更大红
      const level = diff <= 1 ? "green" : diff <= 3 ? "yellow" : "red";
      items.push(item("响度(LUFS)", level,
        `实测 ${integrated.toFixed(1)} LUFS vs 目标 ${TARGET_LUFS}(差 ${diff.toFixed(1)})`,
        { integratedLufs: integrated, target: TARGET_LUFS }));
    }
  }

  return items;
}

// 汇总等级:任一红→red;否则任一黄→yellow;否则 green
function overall(items) {
  if (items.some((i) => i.level === "red")) return "red";
  if (items.some((i) => i.level === "yellow")) return "yellow";
  return "green";
}

const MARK = { green: "🟢", yellow: "🟡", red: "🔴" };

export default async function run(ctx) {
  const { project, log } = ctx;
  await ensureFfmpeg();

  const config = await project.readJSONSafe(FILES.config);
  if (!config) throw new UserError("缺少 config.json。");

  const finalPath = project.p(DIRS.final, "final.mp4");
  try { await fs.access(finalPath); }
  catch { throw new UserError(`找不到成片 ${path.relative(project.dir, finalPath)}。先运行 vibemotion assemble。`); }

  log.step("qa", `体检 ${path.relative(project.dir, finalPath)}`);

  const info = await probe(finalPath);

  const groups = {
    container: checkContainer(info, config),
    visual: await checkVisual(project, finalPath, info.durationSec),
    audio: await checkAudio(info, finalPath),
  };
  const all = [...groups.container, ...groups.visual, ...groups.audio];
  const verdict = overall(all);

  const report = {
    file: path.relative(project.dir, finalPath),
    checkedAt: new Date().toISOString(),
    durationSec: Number.isFinite(info.durationSec) ? Number(info.durationSec.toFixed(3)) : null,
    resolution: info.video ? { width: info.video.width, height: info.video.height } : null,
    overall: verdict,
    summary: {
      green: all.filter((i) => i.level === "green").length,
      yellow: all.filter((i) => i.level === "yellow").length,
      red: all.filter((i) => i.level === "red").length,
    },
    checks: groups,
  };

  await project.writeJSON(path.join(DIRS.final, "qa.json"), report);

  // 人类可读摘要
  const labels = { container: "容器/流", visual: "画面", audio: "音频" };
  for (const [key, items] of Object.entries(groups)) {
    log.raw(`\n  【${labels[key]}】\n`);
    for (const it of items) log.raw(`    ${MARK[it.level]} ${it.name.padEnd(10)} ${it.detail}\n`);
  }
  log.raw(`\n  汇总:🟢${report.summary.green}  🟡${report.summary.yellow}  🔴${report.summary.red}  → ${MARK[verdict]} ${verdict.toUpperCase()}\n`);
  log.dim(`报告:${path.relative(project.dir, project.p(DIRS.final, "qa.json"))}`);

  if (verdict === "red") {
    const reds = all.filter((i) => i.level === "red").map((i) => `${i.name}: ${i.detail}`);
    throw new UserError(`QA 有红项,成片不合格:\n  - ${reds.join("\n  - ")}\n请定位到对应 scene/chunk 修复重渲。`);
  }
  log.ok(`QA 通过(${verdict === "yellow" ? "有黄项提醒,见上" : "全绿"})。下一步:vibemotion export。`);
  return report;
}
