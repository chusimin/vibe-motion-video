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

// 由 width/height 判画幅大类:portrait(竖) / landscape(横) / square(方)。
export function aspectOf(width, height) {
  const w = width || 1080;
  const h = height || 1920;
  const r = w / h;
  if (r >= 1.15) return "landscape";
  if (r <= 0.87) return "portrait";
  return "square";
}

// 响应式布局描述符:模板据此 reflow(列数 / 主体锚点 / 整体宽度上限)。
// 思路同网页响应式声明——同一镜头,竖屏单列居中偏下、横屏居中或双列。
function layoutOf(aspect) {
  if (aspect === "landscape") {
    // 横屏:水平空间富余 → 主体竖直居中、可双列(多项内容铺成两列)、内容收窄到 ~84% 留呼吸。
    return { aspect, columns: 2, anchor: "center", maxContentWidth: "84%", multiColThreshold: 3 };
  }
  if (aspect === "square") {
    return { aspect, columns: 1, anchor: "center", maxContentWidth: "92%", multiColThreshold: 99 };
  }
  // 竖屏:单列、主体略偏下(给顶部留白/钩子呼吸),内容几乎占满宽。
  return { aspect, columns: 1, anchor: "lower", maxContentWidth: "96%", multiColThreshold: 99 };
}

// 把 anchor 语义映射成 SafeFrame 的 justifyContent。
export function justifyForAnchor(anchor) {
  if (anchor === "lower") return "flex-end"; // 偏下(配合 SafeFrame 底部安全区/字幕预留,自然落在中下)
  if (anchor === "upper") return "flex-start";
  return "center";
}

// 内部:从「已规整的 tokens/motion/format」生成 theme。buildTheme 与 buildThemeFromSpec 共用。
function assembleTheme({ palette, fonts, motion, width, height }) {
  const aspect = aspectOf(width, height);
  const layout = layoutOf(aspect);

  // 基准字号按高度缩放:以 1920 高为基准 1.0(竖屏大字),其它分辨率等比。
  const fontScale = (height || 1920) / 1920;
  // 横屏补偿:横屏高度小→fontScale 小,但横向空间富余,给大字号(hero/h1/statNumber)一点回补,
  // 避免横屏标题过于胆怯;正文不补,防止溢出。补偿温和(1.35x)且对 fontScale 封顶。
  const wideBoost = aspect === "landscape" ? 1.35 : 1;

  return {
    palette,
    fonts,
    motion,
    fontScale,
    aspect,
    layout,
    accent: (i = 0) => palette.accent[i % palette.accent.length],
    // 常用排版尺度(px,已乘 fontScale;大字号叠加横屏补偿)
    size: {
      hero: Math.round(150 * fontScale * wideBoost),
      h1: Math.round(104 * fontScale * wideBoost),
      h2: Math.round(76 * fontScale * (aspect === "landscape" ? 1.15 : 1)),
      h3: Math.round(56 * fontScale),
      body: Math.round(44 * fontScale),
      small: Math.round(34 * fontScale),
      caption: Math.round(52 * fontScale),
      statNumber: Math.round(300 * fontScale * wideBoost),
    },
  };
}

// 把 personality + 可选 spring/tracking/stagger 微调,折成模板可用的 motion 对象。
// personality 决定档位(calm 柔 / punchy 脆);spec.motion.spring 等若给,叠加微调。
function buildMotion({ personality, spring, stagger, tracking } = {}) {
  const key = ["calm", "balanced", "punchy"].includes(personality) ? personality : "balanced";
  const base = { ...MOTION_PRESETS[key] };
  // spring 微调(RenderSpec.motion.spring 可含 damping/mass/stiffness 覆盖)
  if (spring && typeof spring === "object") {
    if (Number.isFinite(spring.damping)) base.damping = spring.damping;
    if (Number.isFinite(spring.mass)) base.mass = spring.mass;
    if (Number.isFinite(spring.stiffness)) base.stiffness = spring.stiffness;
  }
  return {
    key,
    personality: key,
    ...base,
    // stagger:逐项出场间隔,单位**秒**(与 RenderSpec.motion.stagger 一致;模板用时 ×fps 转帧)。
    //   缺省 undefined,模板回退到各自基于 speed 的默认步进。
    stagger: Number.isFinite(stagger) ? stagger : undefined,
    // tracking:字距微调(em),透传给需要的模板。
    tracking: Number.isFinite(tracking) ? tracking : undefined,
  };
}

// 主入口(兼容旧路径):从 config 生成 theme 对象。spec 缺失时 VibeVideo 仍走这条。
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

  const motion = buildMotion({ personality: style.motion });

  const width = config.resolution?.width || 1080;
  const height = config.resolution?.height || 1920;
  return assembleTheme({ palette, fonts, motion, width, height });
}

// 新入口:从 RenderSpec 生成 theme 对象(与 buildTheme 同形)。
// spec.tokens → palette/fonts;spec.motion → 动效性格;spec.format → 画幅(驱动字号/响应式)。
// 任一字段缺失都安全兜底(沿用 DEFAULT_PALETTE / balanced / 1080x1920)。
export function buildThemeFromSpec(spec = {}) {
  const t = spec.tokens || {};
  const palette = {
    bg: isHex(t.bg) ? t.bg : DEFAULT_PALETTE.bg,
    fg: isHex(t.fg) ? t.fg : DEFAULT_PALETTE.fg,
    accent:
      Array.isArray(t.accent) && t.accent.length
        ? t.accent.filter(isHex)
        : DEFAULT_PALETTE.accent,
  };
  if (!palette.accent.length) palette.accent = DEFAULT_PALETTE.accent;

  const fonts = {
    display: withFallback(t.fontDisplay),
    body: withFallback(t.fontBody),
  };

  const m = spec.motion || {};
  const motion = buildMotion({
    personality: m.personality,
    spring: m.spring,
    stagger: m.stagger,
    tracking: m.tracking,
  });

  const fmt = spec.format || {};
  const width = fmt.width || 1080;
  const height = fmt.height || 1920;
  const theme = assembleTheme({ palette, fonts, motion, width, height });
  // tokens.radius 透传(部分模板/未来风格包会用到统一圆角)
  if (Number.isFinite(t.radius)) theme.radius = t.radius;
  theme.styleId = spec.styleId || null;
  return theme;
}

export { MOTION_PRESETS, FALLBACK_FONT_STACK, DEFAULT_PALETTE, isHex };
