// editorial-saas 风格包共享原语。
// 设计意图(对标 ObiN / Varchasva):暖亮编辑底 + 巨型切边粗体排版 + 逐词强调
// + 设备框 + 大量留白,紫主绿火花,暗场/满色帧做节拍重音。
//
// ⚠️ 关键约束:resolver.mjs 只把 palette.bg/fg/accent + fonts + radius + motion 注入 spec.tokens,
//    **不会**透传预设里的 darkFrame / punchColors / treatment。所以这些值必须在组件内自带常量,
//    accent 仍走 theme.accent(i)(0=紫 #6C4CF6, 1=绿 #00D26A, 2=红 #FF4D4D)。
import React from "react";
import { spring, interpolate } from "remotion";

// 暗场色(对应 editorial-saas.json 的 darkFrame),组件内自带,不依赖 token 透传。
export const DARK = "#0A0A0B";

// editorial-saas 字距与字重纪律(treatment 块的硬编码版,理由同上)。
export const DISPLAY_TRACKING = "-0.03em"; // 负字距,大字才紧
export const DISPLAY_WEIGHT = 800;

// 满色 punch 帧的轮播色:绿 → 紫 → 暗场(对应 punchColors)。无 token 透传,这里给定。
export function punchPalette(theme) {
  const a = theme?.palette?.accent || [];
  return [a[1] || "#00D26A", a[0] || "#6C4CF6", DARK];
}

// 在某 hex 上判断该用亮字还是暗字(粗略亮度),满色帧上文字配色用。
export function readableOn(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length < 6) return "#FFFFFF";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // 感知亮度
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? "#0B0B0C" : "#F4F2EC";
}

// 逐词强调切分:把整句切成 token,标出**唯一**要强调的那个。
// 规则(对标 ObiN「整句中性 + 唯一关键词换色」):
//   1) 若文本含 **包裹** 的词 → 那个就是强调词(去掉星号)。
//   2) 否则取「最后一个实义词」(跳过尾随标点/极短虚词)作为强调词。
// 返回:[{ text, accent: bool, trailing: string }]，trailing 保留紧跟的标点(逗号/句号)不参与高亮换行。
export function splitEmphasis(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  // 先找显式 **强调**
  const star = text.match(/\*\*(.+?)\*\*/);
  let emphasisIdx = -1;

  // 按空格分词，但把紧跟的标点从词里剥出来，避免「SaaS,」整块换色把逗号也染了
  const rawWords = text.replace(/\*\*/g, "").split(/\s+/).filter(Boolean);
  const words = rawWords.map((w) => {
    const m = w.match(/^([^\s]*?)([,.!?;:，。！？；：]*)$/);
    return { core: m ? m[1] : w, trailing: m ? m[2] : "" };
  });

  if (star) {
    const target = star[1].trim().toLowerCase();
    emphasisIdx = words.findIndex((w) => w.core.toLowerCase() === target);
    if (emphasisIdx < 0) {
      // 多词强调短语：标第一个匹配词起的范围由调用方处理；这里退化为标首个可匹配
      emphasisIdx = words.findIndex((w) => target.includes(w.core.toLowerCase()) && w.core.length > 1);
    }
  }

  if (emphasisIdx < 0) {
    // 取最后一个「实义」词：长度>1，跳过纯虚词
    const stop = new Set(["the", "a", "an", "of", "to", "and", "or", "is", "it", "us", "on", "in", "for", "with", "了", "的", "和", "与"]);
    for (let i = words.length - 1; i >= 0; i--) {
      const c = words[i].core.toLowerCase();
      if (c.length > 1 && !stop.has(c)) { emphasisIdx = i; break; }
    }
    if (emphasisIdx < 0) emphasisIdx = words.length - 1;
  }

  return words.map((w, i) => ({ text: w.core, trailing: w.trailing, accent: i === emphasisIdx }));
}

// 遮罩揭示:返回一个把内容从下向上「擦出」的 clip-path + 轻微上移，配 spring。
// progress ∈ [0,1]。用于巨字逐行揭示，比纯 fade 高级。
export function maskReveal(progress) {
  const p = Math.max(0, Math.min(1, progress));
  // 从 100%(全遮)→ 0%(全露)；底部留一点 inset 让字「升」出来
  const inset = interpolate(p, [0, 1], [100, 0]);
  const y = interpolate(p, [0, 1], [0.18, 0]); // em 单位的上移
  return {
    clipPath: `inset(${inset}% 0% 0% 0%)`,
    transform: `translateY(${y}em)`,
  };
}

// 统一的平滑 spring 进度（editorial 偏顺滑、轻 overshoot）。
export function smoothSpring({ frame, fps, delay = 0, motion }) {
  return spring({
    frame: frame - delay,
    fps,
    config: {
      damping: motion?.overshoot ? 18 : (motion?.damping ?? 22),
      mass: motion?.mass ?? 0.9,
      stiffness: motion?.stiffness ?? 120,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 快节奏运动原语(对标 ObiN:进场极快带 overshoot ~5-9 帧到位,之后镜头内全程不静止)
// ──────────────────────────────────────────────────────────────────────────

// snapSpring —— 超脆弹簧:高 stiffness + 低 damping + 低 mass → 约 5-9 帧冲到位并轻微回弹冲过 1。
// hero 进场专用。返回值会短暂 >1(overshoot),配合 overshootScale/直接乘位移都行。
// 在 30fps 下:stiffness 340 / damping 13 / mass 0.5 ≈ 第 5 帧已 ~0.9、第 8 帧越过 1.0 再收。
export function snapSpring({ frame, fps, delay = 0 }) {
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 13, mass: 0.5, stiffness: 340, overshoot: true },
  });
}

// overshootScale —— 把 snapSpring 的进度折成「从 from 冲到 1、越过一点再收」的 scale。
// snapSpring 本身已带 overshoot,这里只做线性映射 from→1(spring 越过 1 时输出也越过 1)。
export function overshootScale(s, from = 0.6) {
  return from + (1 - from) * s;
}

// punchIn —— 硬砸:很快从偏大(或偏小)scale 冲到 1,带轻 overshoot。PunchFrame/强调词重音用。
// 返回 { scale, opacity },delay 后约 4-6 帧到位。amount 越大砸感越猛(从 1+amount 收到 1)。
export function punchIn({ frame, fps, delay = 0, amount = 0.18 }) {
  const s = snapSpring({ frame, fps, delay });
  const scale = 1 + amount - amount * s; // 1+amount → 1(spring 越过 1 → 略 <1 再回,形成砸+顿)
  const opacity = clampN(s * 2, 0, 1); // 极快显形,避免砸进来时还是透明
  return { scale, opacity, s };
}

// 持续缩放 drift:全程缓慢 scale,镜头永不"定死"。t∈[0,1] 为镜头进度。
// 默认 1.0→1.08 的极缓推进(像 ObiN 满屏字一直在涨)。
export function driftScale(t, from = 1.0, to = 1.08) {
  return from + (to - from) * clampN(t, 0, 1);
}

// 持续位移 drift:正弦 + 线性创动叠加,给 px(或随调用方单位)。镜头内一直在飘,无静止。
// freq=周期内摆动次数(以秒计需调用方传 tSec),amp=幅度。这里以「镜头进度 t」近似:
//   x = ampX * sin(t*2π*loops + phase) + creepX * t
export function driftXY(t, { ampX = 0, ampY = 0, loops = 1, phase = 0, creepX = 0, creepY = 0 } = {}) {
  const a = clampN(t, 0, 1) * Math.PI * 2 * loops + phase;
  return {
    x: ampX * Math.sin(a) + creepX * clampN(t, 0, 1),
    y: ampY * Math.sin(a + Math.PI / 3) + creepY * clampN(t, 0, 1),
  };
}

// 持续旋转/形变 drift:给 deg。线性创动 + 轻正弦,设备框/sparkle/底纹用。
export function driftRot(t, { from = 0, to = 0, wobble = 0, loops = 1 } = {}) {
  const tt = clampN(t, 0, 1);
  return from + (to - from) * tt + wobble * Math.sin(tt * Math.PI * 2 * loops);
}

// 镜头进度:当前帧 / 镜头总帧。给持续 drift 当 t。end 传 durationInFrames。
export function shotProgress(frame, durationInFrames) {
  return clampN(frame / Math.max(1, durationInFrames - 1), 0, 1);
}

function clampN(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
