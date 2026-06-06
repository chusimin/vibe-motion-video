// Resolver:把「用户选择 + 三类预设」合并成无歧义的施工图 RenderSpec。
// 这是整个 skill 唯一的「合并逻辑出口」(见 docs/architecture.md 第 2 节):
//   优先级:品牌 brand > 风格 style > 类型默认 > 全局默认。
// 模板只读 RenderSpec(不认识 "douyin"/"bento"),加新平台/风格 = 加预设文件,不动模板。
//
// 另外提供唯二「真交互」之一:fitBeats(密度拟合,类型 × 时长)。
//   结构预设每个节拍带 priority + min/ideal/maxSec;按预算从高优先级往下塞,
//   在区间内缩放 idealSec,使节拍总时长 ≈ 时长预算。一个 showreel 预设通吃 15/30/60s。

// ───────────────────────── 全局默认(最低优先级兜底)─────────────────────────
// 仅当所有上游(品牌/风格/平台/类型)都没给时才用到。保守、安全、不抢戏。
const DEFAULTS = {
  bg: "#000000",
  fg: "#F5F5F7",
  accent: ["#0A84FF"],
  fontDisplay:
    '-apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif',
  fontBody:
    '-apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif',
  radius: 16,
  motion: "balanced",
  fps: 30,
  safeArea: { top: 60, bottom: 60, left: 60, right: 60 },
  captionStyle: "line",
  loudnessLUFS: -14,
};

const MOTIONS = ["calm", "balanced", "punchy"];

// 动效性格 → 派生的弹簧/字距/错峰提示。组件可直接读 motion.personality,
// 也可用这些派生值做更细的手感(模板子 agent 消费,缺了能自己兜)。
// spring 用 Remotion spring 习惯的 {damping,stiffness,mass};数值越「脆」越 punchy。
const MOTION_DERIVED = {
  calm: {
    spring: { damping: 26, stiffness: 90, mass: 1 },
    tracking: 0, // 字距(em):沉稳不加宽
    stagger: 0.08, // 逐项错峰(秒):慢
  },
  balanced: {
    spring: { damping: 20, stiffness: 140, mass: 1 },
    tracking: 0.01,
    stagger: 0.06,
  },
  punchy: {
    spring: { damping: 14, stiffness: 220, mass: 1 },
    tracking: 0.02, // 略加宽,更有冲击力
    stagger: 0.04, // 快,脆生砸出
  },
};

// 安全取颜色数组:过滤掉非字符串/空串,去重。
function cleanColors(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const c of arr) {
    if (typeof c === "string" && c.trim()) {
      const v = c.trim();
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

// 取第一个非空字符串。
function firstStr(...xs) {
  for (const x of xs) {
    if (typeof x === "string" && x.trim()) return x.trim();
  }
  return undefined;
}

// 把 motion 收敛到合法枚举,非法回退 balanced。
function normalizeMotion(m) {
  return MOTIONS.includes(m) ? m : DEFAULTS.motion;
}

// ───────────────────────── resolveRenderSpec ─────────────────────────
// 入参:
//   config         —— config.json(已是 type/platform/style 的合并结果;含 style.palette/fonts/motion、brand)
//   platformPreset —— presets/platforms/<platform>.json(safeArea/captions/loudness…)
//   stylePreset    —— presets/styles/<style>.json(可选;config.style 已含合并结果,这里仅作兜底来源)
// 产出:RenderSpec(契约见 docs/architecture.md 第 2 节 / 本仓 README)。
export function resolveRenderSpec({ config = {}, platformPreset = {}, stylePreset = {} } = {}) {
  const style = config.style || {};
  const brand = config.brand || {};
  const sp = stylePreset || {};

  // ── format ── 来自 config 分辨率/fps/画幅 + 平台 safeArea/captions/loudness。
  const width = config.resolution?.width ?? platformPreset.resolution?.width ?? 1080;
  const height = config.resolution?.height ?? platformPreset.resolution?.height ?? 1920;
  const fps = config.fps ?? platformPreset.fps ?? DEFAULTS.fps;
  const aspect = config.aspectRatio ?? platformPreset.aspectRatio ??
    (width && height ? `${width}:${height}` : "9:16");

  const safeArea = { ...DEFAULTS.safeArea, ...(platformPreset.safeArea || {}) };
  // 字幕样式优先级:config.captions.style(已收敛枚举)> 平台 captions.style > 默认。
  const captionStyle = firstStr(
    config.captions?.style,
    platformPreset.captions?.style,
    DEFAULTS.captionStyle
  );
  const loudnessLUFS =
    typeof platformPreset.loudnessLUFS === "number"
      ? platformPreset.loudnessLUFS
      : DEFAULTS.loudnessLUFS;
  // 每行字数(竖屏小、横屏大):平台 captions.maxCharsPerLine。模板排字幕会用到。
  const maxCharsPerLine =
    platformPreset.captions?.maxCharsPerLine ?? (aspect === "9:16" ? 14 : 42);

  const format = {
    width,
    height,
    fps,
    aspect,
    safeArea,
    captionStyle,
    loudnessLUFS,
    maxCharsPerLine,
  };

  // ── tokens ── style 合并结果打底,brand 覆盖(品牌优先级最高)。
  // bg/fg:风格 palette → 风格预设 → 默认。
  const bg = firstStr(style.palette?.bg, sp.palette?.bg, DEFAULTS.bg);
  const fg = firstStr(style.palette?.fg, sp.palette?.fg, DEFAULTS.fg);

  // accent:先取风格强调色;品牌色 brand.colors 若有 → 整组覆盖(品牌身份压过风格)。
  const styleAccent = cleanColors(
    (style.palette?.accent && style.palette.accent.length ? style.palette.accent : sp.palette?.accent) || []
  );
  const brandColors = cleanColors(brand.colors);
  const accent = brandColors.length ? brandColors : (styleAccent.length ? styleAccent : DEFAULTS.accent.slice());

  // 字体:fontDisplay 受品牌覆盖(brand.fonts.display 或 brand.fontDisplay);fontBody 同理。
  const fontDisplay = firstStr(
    brand.fonts?.display,
    brand.fontDisplay,
    style.fonts?.display,
    sp.fonts?.display,
    DEFAULTS.fontDisplay
  );
  const fontBody = firstStr(
    brand.fonts?.body,
    brand.fontBody,
    style.fonts?.body,
    sp.fonts?.body,
    DEFAULTS.fontBody
  );

  // 圆角 radius:风格可声明(style.radius 或风格预设 radius),否则默认。品牌一般不碰圆角。
  const radius =
    (typeof style.radius === "number" && style.radius) ||
    (typeof sp.radius === "number" && sp.radius) ||
    DEFAULTS.radius;

  const tokens = { bg, fg, accent, fontDisplay, fontBody, radius };

  // ── motion ── 动效性格来自 config.style.motion(已从风格预设映射),附派生 spring/tracking/stagger。
  const personality = normalizeMotion(firstStr(style.motion, sp.motion) || DEFAULTS.motion);
  const derived = MOTION_DERIVED[personality];
  const motion = {
    personality,
    spring: { ...derived.spring },
    tracking: derived.tracking,
    stagger: derived.stagger,
  };

  // ── styleId ── 供模板解析挑风格变体(templates/styles/<styleId>/…)。
  const styleId = firstStr(style.preset, sp.id) || "default";

  return { styleId, format, tokens, motion };
}

// ───────────────────────── fitBeats(密度拟合:类型 × 时长)─────────────────────────
// 入参:
//   structurePreset —— presets/structures/<type>.json(每个 beat 带 priority + min/ideal/maxSec)
//   durationSec     —— 目标总时长预算
//   fps             —— 帧率(用于把每拍 sec 吸附到整帧)
// 规则:
//   1) 必选恒保留:priority 最高(数值最大)的那批节拍一定纳入,即使预算紧也保留(再缩到 minSec)。
//   2) 按 priority 从高到低纳入可选节拍,直到预算被「理想时长」填满。
//   3) 已纳入的节拍按比例缩放 idealSec 命中预算,但夹在各自 [minSec,maxSec] 内。
//   4) 每拍 sec 帧对齐 round(sec*fps)/fps;同 role 多次出现各自独立计数。
// 返回:[{ role, purpose, sec, visualHint }](按预设原顺序,已选中的子集)。
export function fitBeats(structurePreset = {}, durationSec, fps = 30) {
  const rawBeats = Array.isArray(structurePreset.beats) ? structurePreset.beats : [];
  const budget = Number(durationSec) > 0 ? Number(durationSec) : (structurePreset.defaultDurationSec || 30);
  const F = Number(fps) > 0 ? Number(fps) : 30;
  const snap = (sec) => Math.round(sec * F) / F;

  if (rawBeats.length === 0) return [];

  // 归一化每个节拍的拟合字段;兼容旧字段(suggestedSec→ideal)、缺省补默认。
  const beats = rawBeats.map((b, i) => {
    const ideal =
      num(b.idealSec) ?? num(b.suggestedSec) ?? num(b.sec) ?? 4;
    let min = num(b.minSec);
    let max = num(b.maxSec);
    // 缺 min/max 时围绕 ideal 给个保守区间(±40%),并夹合理下限。
    if (min == null) min = Math.max(1, +(ideal * 0.6).toFixed(2));
    if (max == null) max = +(ideal * 1.6).toFixed(2);
    if (max < min) max = min;
    const idealClamped = Math.min(Math.max(ideal, min), max);
    // priority 缺省给 3(中);数值越大越优先,最高的为「必选」。
    const priority = num(b.priority) ?? 3;
    return {
      _i: i,
      role: b.role,
      purpose: b.purpose || "",
      visualHint: b.visualHint || (b.visual && b.visual.type) || null,
      min,
      max,
      ideal: idealClamped,
      priority,
    };
  });

  // 必选 = priority 取到最大值的那批节拍(恒保留)。
  const maxPriority = Math.max(...beats.map((b) => b.priority));
  const mandatory = beats.filter((b) => b.priority === maxPriority);
  const optional = beats
    .filter((b) => b.priority < maxPriority)
    // 可选项按 priority 降序纳入;同优先级保持原顺序(稳定)。
    .sort((a, b) => (b.priority - a.priority) || (a._i - b._i));

  // 1) 先纳入全部必选。
  const selected = [...mandatory];
  let sumIdeal = sum(selected.map((b) => b.ideal));
  let sumMin = sum(selected.map((b) => b.min));

  // 2) 逐个尝试纳入可选节拍:只要纳入后「所有已选的 minSec 之和」不超预算,就纳入。
  //    用 minSec 作准入门槛 → 保证选中的集合在预算内一定塞得下(后面缩放可达成)。
  for (const b of optional) {
    if (sumMin + b.min <= budget + 1e-6) {
      selected.push(b);
      sumIdeal += b.ideal;
      sumMin += b.min;
    }
    // 预算已被理想值填满 → 不再纳入更多(保持密度,不硬塞)。
    if (sumIdeal >= budget) break;
  }

  // 3) 缩放命中预算:把 selected 的 ideal 等比缩放到总和≈budget,各自夹 [min,max]。
  //    用迭代法处理「夹紧后剩余预算再分摊」:固定被夹住的,继续缩放未夹住的。
  const fitted = scaleToBudget(selected, budget);

  // 4) 还原预设原始顺序 + 帧对齐。scaleToBudget 后 Σ 已≈budget,这里只消除「逐拍取整」带来的
  //    亚帧级漂移:把残差(必然 < 拍数个帧)吸附到最后一拍,并夹住防止个别拍被异常拉长。
  const ordered = fitted.slice().sort((a, b) => a._i - b._i);
  const budgetSnapped = snap(budget);
  let acc = 0;
  const result = ordered.map((b, idx) => {
    let sec;
    if (idx === ordered.length - 1) {
      // 末拍 = 帧对齐预算 - 已分配;残差很小,但夹在 [min, 计算值+1拍冗余] 内,绝不吞掉大块预算。
      const target = snap(b.sec);
      const residual = budgetSnapped - acc;
      const lo = snap(Math.min(b.min, target));
      const hi = snap(target + Math.max(1 / F, 0.5)); // 至多比目标多 ~0.5s,杜绝堆积
      sec = Math.max(lo, Math.min(hi, residual));
    } else {
      sec = Math.max(snap(0.2), snap(b.sec));
      acc += sec;
    }
    return {
      role: b.role,
      purpose: b.purpose,
      sec: +sec.toFixed(6),
      visualHint: b.visualHint,
    };
  });
  return result;
}

// 等比缩放一组 {ideal,min,max} 使 Σ ≈ budget,夹各自区间;迭代固定越界项。
// 给每个对象写回 .sec。
function scaleToBudget(items, budget) {
  const arr = items.map((b) => ({ ...b, sec: b.ideal, _locked: false }));
  if (arr.length === 0) return arr;

  for (let iter = 0; iter < 12; iter++) {
    const lockedSum = sum(arr.filter((b) => b._locked).map((b) => b.sec));
    const free = arr.filter((b) => !b._locked);
    if (free.length === 0) break;
    const freeIdealSum = sum(free.map((b) => b.ideal)) || 1;
    const remain = budget - lockedSum;
    const scale = remain / freeIdealSum;

    let clampedAny = false;
    for (const b of free) {
      const want = b.ideal * scale;
      if (want < b.min - 1e-9) {
        b.sec = b.min;
        b._locked = true;
        clampedAny = true;
      } else if (want > b.max + 1e-9) {
        b.sec = b.max;
        b._locked = true;
        clampedAny = true;
      } else {
        b.sec = want;
      }
    }
    if (!clampedAny) break; // 没有新越界 → 收敛
  }

  // 收口:若全部被夹到 max 后总和仍不足预算(节拍区间撑不满这么长的片),
  // 把剩余时长按 ideal 权重「优雅溢出」均摊到各拍(轻微超 max,而不是堆给最后一拍)。
  const total = sum(arr.map((b) => b.sec));
  const slack = budget - total;
  if (slack > 1e-6) {
    const idealSum = sum(arr.map((b) => b.ideal)) || arr.length;
    for (const b of arr) b.sec += slack * (b.ideal / idealSum);
  }
  return arr;
}

// 小工具
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function sum(xs) {
  return xs.reduce((a, b) => a + (Number(b) || 0), 0);
}

export default { resolveRenderSpec, fitBeats };
