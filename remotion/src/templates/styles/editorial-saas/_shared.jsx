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
