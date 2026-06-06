// 步骤④ —— 分镜 IR(storyboard)的机械部分。
// agent 写 storyboard.json(创意);这里只做:校验时间一致性 / 帧对齐修正 / 15s 贪心分段。
// storyboard.json 是渲染器无关的 IR,后面 Remotion 渲染它。
import { FILES } from "../lib/project.mjs";
import { assertValid } from "../lib/validate.mjs";
import { UserError } from "../lib/log.mjs";

const EPS = 1e-3;            // 时间连续性容差(秒)
const FRAME_EPS = 0.01;     // 帧对齐容差(帧)
const DURATION_TOLERANCE = 0.15; // 总时长 vs 目标的偏差告警阈值 ±15%

// 四舍五入到帧网格:把秒数吸附到最近的整帧
function snapToFrame(sec, fps) {
  return Math.round(sec * fps) / fps;
}

// |dur*fps - round(dur*fps)| —— 距离最近整帧的帧偏差
function frameDrift(sec, fps) {
  const frames = sec * fps;
  return Math.abs(frames - Math.round(frames));
}

// 读 storyboard + config(config 可缺省,缺了部分检查降级)
async function load(project) {
  const sb = await project.readJSONSafe(FILES.storyboard);
  if (!sb) {
    throw new UserError(
      `找不到或无法解析 ${FILES.storyboard}。请先写入分镜骨架(storyboard schema)。`
    );
  }
  const config = await project.readJSONSafe(FILES.config);
  return { sb, config };
}

// 时间一致性检查 —— 返回 { errors:[], warns:[] }(不抛,交给调用方决定)
function checkTiming(sb, config) {
  const errors = [];
  const warns = [];
  const fps = sb.fps;
  const scenes = sb.scenes || [];

  // 1) 升序 + 首镜从 0 开始 + 相邻无缝
  let prevStart = -Infinity;
  scenes.forEach((sc, i) => {
    const id = sc.id || `scenes[${i}]`;
    if (typeof sc.startSec !== "number" || typeof sc.durationSec !== "number") {
      errors.push(`${id}: startSec/durationSec 不是数字`);
      return;
    }
    if (i === 0 && Math.abs(sc.startSec - 0) > EPS) {
      errors.push(`${id}: 首镜 startSec 应为 0,实际 ${sc.startSec}`);
    }
    if (sc.startSec < prevStart - EPS) {
      errors.push(`${id}: startSec(${sc.startSec}) 不是升序(前一镜 ${prevStart})`);
    }
    prevStart = sc.startSec;

    // 相邻无缝:next.start ≈ cur.start + cur.dur
    if (i + 1 < scenes.length) {
      const next = scenes[i + 1];
      if (typeof next.startSec === "number" && typeof sc.durationSec === "number") {
        const expected = sc.startSec + sc.durationSec;
        const gap = next.startSec - expected;
        if (Math.abs(gap) > EPS) {
          const kind = gap > 0 ? "缝隙(gap)" : "重叠(overlap)";
          errors.push(
            `${id}→${next.id || `scenes[${i + 1}]`}: ${kind} ${gap.toFixed(4)}s ` +
            `(期望下一镜 start=${expected.toFixed(4)},实际 ${next.startSec})`
          );
        }
      }
    }
  });

  // 2) totalDurationSec ≈ Σ durationSec
  const sumDur = scenes.reduce((a, sc) => a + (typeof sc.durationSec === "number" ? sc.durationSec : 0), 0);
  if (typeof sb.totalDurationSec === "number") {
    if (Math.abs(sb.totalDurationSec - sumDur) > EPS) {
      errors.push(
        `totalDurationSec(${sb.totalDurationSec}) ≠ Σ durationSec(${sumDur.toFixed(4)}),差 ` +
        `${(sb.totalDurationSec - sumDur).toFixed(4)}s`
      );
    }
  } else {
    errors.push(`totalDurationSec 缺失或非数字`);
  }

  // 3) 帧对齐:每个 durationSec*fps 距整帧 > FRAME_EPS → warn
  if (typeof fps === "number" && fps > 0) {
    scenes.forEach((sc, i) => {
      if (typeof sc.durationSec !== "number") return;
      const drift = frameDrift(sc.durationSec, fps);
      if (drift > FRAME_EPS) {
        const id = sc.id || `scenes[${i}]`;
        warns.push(
          `${id}: durationSec=${sc.durationSec} 在 ${fps}fps 下不对齐整帧 ` +
          `(${(sc.durationSec * fps).toFixed(4)} 帧,偏差 ${drift.toFixed(4)} 帧)→ 跑 \`storyboard fix\``
        );
      }
    });
  }

  // 4) 总时长 vs config.durationTargetSec 偏差 > ±15% → warn
  if (config && typeof config.durationTargetSec === "number" && config.durationTargetSec > 0) {
    const target = config.durationTargetSec;
    const dev = (sumDur - target) / target;
    if (Math.abs(dev) > DURATION_TOLERANCE) {
      warns.push(
        `总时长 ${sumDur.toFixed(2)}s 与目标 ${target}s 偏差 ${(dev * 100).toFixed(1)}% ` +
        `(超过 ±${DURATION_TOLERANCE * 100}%)`
      );
    }
  } else if (!config) {
    warns.push(`未找到 config.json,跳过「总时长 vs 目标时长」检查。`);
  }

  return { errors, warns };
}

// ── validate ──────────────────────────────────────────────
async function cmdValidate(project, log) {
  const { sb, config } = await load(project);
  // 先 schema 校验(结构/枚举/必填)
  await assertValid("storyboard", sb);

  const { errors, warns } = checkTiming(sb, config);
  for (const w of warns) log.warn(w);
  if (errors.length) {
    throw new UserError(`storyboard 时间一致性检查失败:\n  - ${errors.join("\n  - ")}`);
  }
  // 全部通过 → 只 log.ok,不设 done(plan 之后才算这步完成)
  const n = sb.scenes.length;
  log.ok(
    `storyboard 校验通过:${n} 个镜头,总时长 ${sb.totalDurationSec}s @ ${sb.fps}fps,时间连续且帧对齐。` +
    (warns.length ? ` (${warns.length} 条提醒,见上)` : "")
  );
  log.dim("下一步:vibemotion storyboard plan(按 chunkSec 切 15s 分段)。");
}

// ── fix ───────────────────────────────────────────────────
// 把每个 scene.durationSec 吸附到帧网格,重算所有 startSec 使相邻无缝,
// 首镜 start=0,更新 totalDurationSec。用于消除时间漂移。
async function cmdFix(project, log) {
  const { sb } = await load(project);
  await assertValid("storyboard", sb);
  const fps = sb.fps;
  if (typeof fps !== "number" || fps <= 0) {
    throw new UserError(`storyboard.fps 非法(${fps}),无法做帧对齐。`);
  }
  const scenes = sb.scenes || [];
  if (!scenes.length) throw new UserError(`storyboard.scenes 为空,无可修。`);

  let cursor = 0;
  let fixedCount = 0;
  for (const sc of scenes) {
    const beforeDur = sc.durationSec;
    const beforeStart = sc.startSec;
    const snappedDur = snapToFrame(sc.durationSec, fps);
    sc.durationSec = snappedDur;
    sc.startSec = snapToFrame(cursor, fps); // cursor 已是整帧累加,snap 仅防浮点毛刺
    cursor = sc.startSec + sc.durationSec;
    if (Math.abs(beforeDur - sc.durationSec) > 1e-9 || Math.abs(beforeStart - sc.startSec) > 1e-9) {
      fixedCount++;
    }
  }
  const newTotal = snapToFrame(cursor, fps);
  const beforeTotal = sb.totalDurationSec;
  sb.totalDurationSec = newTotal;

  await project.writeJSON(FILES.storyboard, sb);
  log.ok(
    `已吸附到 ${fps}fps 帧网格:调整了 ${fixedCount} 个镜头,` +
    `总时长 ${beforeTotal} → ${newTotal}s,相邻已无缝、首镜从 0 开始。`
  );
  log.dim("建议复跑:vibemotion storyboard validate 确认干净。");
}

// ── plan ──────────────────────────────────────────────────
// 按 config.chunkSec(默认 15)把连续 scene 贪心打包成 ~15s 的 chunk。
// 只在 scene 边界切;单个 scene 超过 chunkSec 自成一段。
// 写回 storyboard.json.chunks,并镜像进 STATE.chunks。完成本步 → setStep done。
async function cmdPlan(project, log) {
  const { sb, config } = await load(project);
  await assertValid("storyboard", sb);

  // 先做一次时间检查;有错就别切,让用户先 fix
  const { errors, warns } = checkTiming(sb, config);
  for (const w of warns) log.warn(w);
  if (errors.length) {
    throw new UserError(
      `分段前时间一致性未通过,请先 \`storyboard fix\` / 修分镜:\n  - ${errors.join("\n  - ")}`
    );
  }

  const chunkSec = (config && typeof config.chunkSec === "number" && config.chunkSec >= 5)
    ? config.chunkSec
    : 15;
  const scenes = sb.scenes;

  // 贪心打包:从前往后累加 scene,直到再加一个就超过 chunkSec 则封段。
  // 单 scene 自身 ≥ chunkSec 时独占一段(不能在 scene 内部切)。
  const chunks = [];
  let cur = null; // { sceneIds, startSec, durationSec }
  for (const sc of scenes) {
    const d = sc.durationSec;
    if (cur === null) {
      cur = { sceneIds: [sc.id], startSec: sc.startSec, durationSec: d };
      // 单镜已 ≥ chunkSec:独占一段,立即封段
      if (d >= chunkSec) { chunks.push(cur); cur = null; }
      continue;
    }
    // 已有在攒的段:加上这个 scene 会不会超?超了就先封旧段,这个 scene 起新段
    if (cur.durationSec + d > chunkSec + EPS) {
      chunks.push(cur);
      cur = { sceneIds: [sc.id], startSec: sc.startSec, durationSec: d };
      if (d >= chunkSec) { chunks.push(cur); cur = null; }
    } else {
      cur.sceneIds.push(sc.id);
      cur.durationSec += d;
    }
  }
  if (cur !== null) chunks.push(cur);

  // 落定 index + status,并补一致的 durationSec(用 start 差/末镜结尾,避免浮点累积)
  const built = chunks.map((c, index) => ({
    index,
    sceneIds: c.sceneIds,
    startSec: c.startSec,
    durationSec: c.durationSec,
    status: "pending",
  }));

  sb.chunks = built;
  await project.writeJSON(FILES.storyboard, sb);

  // 镜像进 STATE.chunks(精简:index/sceneIds/startSec/durationSec/status)
  await project.patchState({
    chunks: built.map((c) => ({
      index: c.index,
      sceneIds: c.sceneIds,
      startSec: c.startSec,
      durationSec: c.durationSec,
      status: c.status,
    })),
  });

  await project.setStep("storyboard", "done");

  // 分段概览
  log.ok(`已切分 ${built.length} 段(chunkSec=${chunkSec}s,只在镜头边界切):`);
  for (const c of built) {
    const over = c.durationSec > chunkSec + EPS ? "  ⚠ 单镜超长,独占一段" : "";
    log.raw(
      `  chunk ${c.index}: ${c.sceneIds.length} 镜 [${c.sceneIds.join(", ")}]  ` +
      `start=${c.startSec.toFixed(3)}s  dur=${c.durationSec.toFixed(3)}s${over}\n`
    );
  }
  log.dim("分段已镜像进 STATE.chunks;storyboard 步骤完成 → 进入配音/渲染。");
}

export default async function run(ctx) {
  const { project, positionals, log } = ctx;
  const sub = positionals[0];

  switch (sub) {
    case "validate":
      return cmdValidate(project, log);
    case "plan":
      return cmdPlan(project, log);
    case "fix":
      return cmdFix(project, log);
    case undefined:
      throw new UserError("storyboard 需要子命令:validate | plan | fix。");
    default:
      throw new UserError(`未知子命令 storyboard ${sub}。可用:validate | plan | fix。`);
  }
}
