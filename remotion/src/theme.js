// theme.js —— 把 config.style(palette/fonts/motion)映射成模板可直接用的具体数值。
// 纯函数、无 React 依赖,模板与背景组件共用。

import { interpolate } from "remotion";

// motion 档位 → 动效参数(spring 阻尼、入场位移、整体提速系数)。
// calm=克制、balanced=适中、punchy=强烈。
const MOTION_PRESETS = {
  calm: { damping: 200, mass: 1.0, stiffness: 100, enterShiftPx: 28, overshoot: false, speed: 0.85 },
  balanced: { damping: 26, mass: 0.8, stiffness: 120, enterShiftPx: 48, overshoot: true, speed: 1.0 },
  punchy: { damping: 13, mass: 0.7, stiffness: 180, enterShiftPx: 80, overshoot: true, speed: 1.25 },
};

const FALLBACK_FONT_STACK =
  '-apple-system, "PingFang SC", "Source Han Sans SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

// 默认调色板(任何字段缺失时兜底,确保渲染不崩)。
const DEFAULT_PALETTE = {
  bg: "#0B0B0F",
  fg: "#FFFFFF",
  accent: ["#0A84FF", "#30D158", "#FF375F"],
};

// 把字体声明补上中文兜底字体,避免缺字变豆腐块。
function withFallback(fontStack) {
  if (!fontStack || typeof fontStack !== "string") return FALLBACK_FONT_STACK;
  // 已含中文兜底就原样返回,否则追加。
  if (/PingFang|Source Han|YaHei|sans-serif/i.test(fontStack)) return fontStack;
  return `${fontStack}, ${FALLBACK_FONT_STACK}`;
}

// 简单 hex 校验。
function isHex(s) {
  return typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
}

// hex → {r,g,b}
function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// 在两个 hex 间线性插值,返回 rgb 字符串。
export function mixHex(a, b, t) {
  const A = hexToRgb(isHex(a) ? a : DEFAULT_PALETTE.bg);
  const B = hexToRgb(isHex(b) ? b : DEFAULT_PALETTE.fg);
  const r = Math.round(interpolate(t, [0, 1], [A.r, B.r], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const g = Math.round(interpolate(t, [0, 1], [A.g, B.g], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const bl = Math.round(interpolate(t, [0, 1], [A.b, B.b], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return `rgb(${r}, ${g}, ${bl})`;
}

// hex + alpha(0..1)→ rgba 字符串。
export function withAlpha(hex, alpha) {
  if (!isHex(hex)) return `rgba(255,255,255,${alpha})`;
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 解析 bg 描述符 → CSS background 值。
// 支持:hex(#fff)/ rgba / 渐变名(brand.gradient.N、accent、palette)/ "media"(由组件另接素材,这里给透明)。
// accent 数组用于自动生成渐变。
export function resolveBackground(desc, palette) {
  const accent = (palette?.accent && palette.accent.length ? palette.accent : DEFAULT_PALETTE.accent);
  const bgBase = isHex(palette?.bg) ? palette.bg : DEFAULT_PALETTE.bg;

  if (!desc || typeof desc !== "string") {
    return { type: "color", css: bgBase };
  }
  const d = desc.trim();

  // 直接颜色
  if (isHex(d)) return { type: "color", css: d };
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(d)) return { type: "color", css: d };
  if (/^(linear|radial|conic)-gradient\(/i.test(d)) return { type: "gradient", css: d };

  // media:由调用方用 <Img>/<OffthreadVideo> 接,这里背景给基础色兜底
  if (d === "media" || /^media[:/]/i.test(d)) {
    return { type: "media", css: bgBase };
  }

  // 渐变名:brand.gradient.1 / gradient.2 / accent.1 等 → 用 accent 生成
  // 取末尾数字作为主色索引(1-based)
  const m = d.match(/(\d+)\s*$/);
  const idx = m ? Math.max(0, Math.min(accent.length - 1, parseInt(m[1], 10) - 1)) : 0;

  if (/gradient/i.test(d)) {
    const c1 = accent[idx] || accent[0];
    const c2 = accent[(idx + 1) % accent.length] || accent[0];
    // 深底之上的彩色斜向渐变,压暗一点更高级
    return {
      type: "gradient",
      css: `linear-gradient(135deg, ${withAlpha(c1, 0.95)} 0%, ${withAlpha(c2, 0.85)} 55%, ${bgBase} 100%)`,
    };
  }

  // 命名颜色 accent / fg / bg
  if (/^accent/i.test(d)) return { type: "color", css: accent[idx] || accent[0] };
  if (/^fg$/i.test(d)) return { type: "color", css: isHex(palette?.fg) ? palette.fg : DEFAULT_PALETTE.fg };
  if (/^bg$/i.test(d)) return { type: "color", css: bgBase };

  // 兜底:当作 CSS 颜色直接给(浏览器能认的命名色如 "black")
  return { type: "color", css: d };
}

// 主入口:从 config 生成 theme 对象。
export function buildTheme(config = {}) {
  const style = config.style || {};
  const palette = {
    bg: isHex(style.palette?.bg) ? style.palette.bg : DEFAULT_PALETTE.bg,
    fg: isHex(style.palette?.fg) ? style.palette.fg : DEFAULT_PALETTE.fg,
    accent:
      Array.isArray(style.palette?.accent) && style.palette.accent.length
        ? style.palette.accent.filter(isHex)
        : DEFAULT_PALETTE.accent,
  };
  if (!palette.accent.length) palette.accent = DEFAULT_PALETTE.accent;

  const fonts = {
    display: withFallback(style.fonts?.display),
    body: withFallback(style.fonts?.body),
  };

  const motionKey = ["calm", "balanced", "punchy"].includes(style.motion) ? style.motion : "balanced";
  const motion = { key: motionKey, ...MOTION_PRESETS[motionKey] };

  // 基准字号按高度缩放:以 1920 高为基准 1.0(竖屏大字),其它分辨率等比。
  const height = config.resolution?.height || 1920;
  const fontScale = height / 1920;

  return {
    palette,
    fonts,
    motion,
    fontScale,
    accent: (i = 0) => palette.accent[i % palette.accent.length],
    // 常用排版尺度(px,已乘 fontScale)
    size: {
      hero: Math.round(150 * fontScale),
      h1: Math.round(104 * fontScale),
      h2: Math.round(76 * fontScale),
      h3: Math.round(56 * fontScale),
      body: Math.round(44 * fontScale),
      small: Math.round(34 * fontScale),
      caption: Math.round(52 * fontScale),
      statNumber: Math.round(300 * fontScale),
    },
  };
}

export { MOTION_PRESETS, FALLBACK_FONT_STACK, DEFAULT_PALETTE, isHex };
