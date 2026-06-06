// 模板解析器 —— resolveTemplate(type, styleId) → React 组件。
// 架构(见 docs/architecture.md §4):override + fallback,绝不 type×style 爆炸。
//   1. 风格覆盖:styles/<styleId>/<Type>.jsx —— 只放这风格真正长得不一样的那几个
//   2. 通用层:  _base/<Type>.jsx          —— 任何风格的兜底
//   3. 终极兜底:_base 的 bg-only          —— 未知 type 也不黑屏
//
// ⚠️ Remotion bundle 用 Babel 静态分析 import,无法解析动态变量路径
//   (`import(`./styles/${id}/${T}`)` 这种会被打包器漏掉 → 渲染期 404)。
//   因此「注册」一律是:文件顶部静态 import 组件 + 写进下面的对象映射表。
//   加一个风格覆盖 = 顶部加一行 import + 在 STYLE_OVERRIDES 里登记一项,仅此而已。

import { BASE } from "./_base/index.jsx";

// ───────────────────── 风格覆盖注册表(现在为空) ─────────────────────
// 怎么加(示例,先别取消注释,等真有 styles/bento/Stat.jsx 时再开):
//
//   import BentoStat from "./styles/bento/Stat.jsx";
//   import BentoTitle from "./styles/bento/Title.jsx";
//   ...
//   export const STYLE_OVERRIDES = {
//     bento: { stat: BentoStat, title: BentoTitle },   // 只覆盖这两个;其余仍走 _base
//   };
//
// 键约定:外层 = styleId(与 RenderSpec.styleId 一致),内层 = visual.type(与 storyboard 一致)。
export const STYLE_OVERRIDES = {
  // 暂空:所有 type 全部走 _base 通用层。按拆解出的真实证据再增量添加。
};

// type 别名归一:容忍下划线/驼峰/简写写法,统一到 _base 注册表的连字符键。
const TYPE_ALIASES = {
  kinetic_text: "kinetic-text",
  kinetictext: "kinetic-text",
  kinetic: "kinetic-text",
  feature_reveal: "feature-reveal",
  featurereveal: "feature-reveal",
  feature: "feature-reveal",
  product_capture: "product-capture",
  productcapture: "product-capture",
  capture: "product-capture",
  screen: "product-capture",
  bullet_list: "bullet-list",
  bulletlist: "bullet-list",
  bullets: "bullet-list",
  list: "bullet-list",
  lower_third: "lower-third",
  lowerthird: "lower-third",
  bg_only: "bg-only",
  bgonly: "bg-only",
  bg: "bg-only",
  cards: "feature-reveal",
};

// 把任意 type 写法归一成 _base 的标准键。
export function normalizeType(type) {
  if (!type || typeof type !== "string") return null;
  const k = type.trim().toLowerCase();
  if (BASE[k]) return k; // 已是标准键
  return TYPE_ALIASES[k] || k;
}

// 已警告过的 (styleId,type) 组合,避免逐帧刷屏。
const warned = new Set();

// 核心解析:风格覆盖 → 通用层 → bg-only 兜底。
//   type:    storyboard 的 visual.type(允许别名/未知)
//   styleId: RenderSpec.styleId(允许缺省 / 未知风格)
//   scene:   可选,仅用于「未知 type」时选更聪明的兜底(有屏幕文字→title)。
export function resolveTemplate(type, styleId, scene) {
  const key = normalizeType(type);

  // 1) 风格覆盖(若该风格登记了该 type)
  const override = styleId ? STYLE_OVERRIDES[styleId]?.[key] : null;
  if (override) return override;

  // 2) 通用层
  if (key && BASE[key]) return BASE[key];

  // 3) 未知 type → 智能兜底:有屏幕文字给 title(不空),否则 bg-only(纯背景)
  const fallbackKey = scene?.onScreenText ? "title" : "bg-only";
  const wkey = `${styleId || "-"}::${type || "-"}`;
  if (type && !warned.has(wkey)) {
    warned.add(wkey);
    // eslint-disable-next-line no-console
    console.warn(
      `[vibe] 未知 visual.type="${type}"(style=${styleId || "default"}),已退化为 ${fallbackKey}` +
        (scene?.id ? `(scene ${scene.id})` : "")
    );
  }
  // 兜底也优先吃风格覆盖(若风格连兜底都要换皮),否则 _base
  return STYLE_OVERRIDES[styleId]?.[fallbackKey] || BASE[fallbackKey];
}
