// 模板注册表:visual.type → 组件。未知 type 退化(有 media→ProductCapture,否则 Title/BgOnly)并 warn。
import Title from "./Title.jsx";
import FeatureReveal from "./FeatureReveal.jsx";
import ProductCapture from "./ProductCapture.jsx";
import KineticText from "./KineticText.jsx";
import BulletList from "./BulletList.jsx";
import Quote from "./Quote.jsx";
import Stat from "./Stat.jsx";
import Comparison from "./Comparison.jsx";
import Cta from "./Cta.jsx";
import LowerThird from "./LowerThird.jsx";
import BgOnly from "./BgOnly.jsx";

export const TEMPLATES = {
  title: Title,
  "feature-reveal": FeatureReveal,
  "product-capture": ProductCapture,
  "kinetic-text": KineticText,
  "bullet-list": BulletList,
  quote: Quote,
  stat: Stat,
  comparison: Comparison,
  cta: Cta,
  "lower-third": LowerThird,
  "bg-only": BgOnly,
};

// 已警告过的未知类型集合(避免逐帧刷屏)
const warned = new Set();

export function pickTemplate(scene = {}) {
  const type = scene?.visual?.type;
  const comp = TEMPLATES[type];
  if (comp) return comp;
  // 退化:有屏幕文字→Title(信息密度低但不空),否则 BgOnly(纯背景)
  const fallbackType = scene?.onScreenText ? "title" : "bg-only";
  if (type && !warned.has(type)) {
    warned.add(type);
    // 渲染期 console.warn 会被 onBrowserLog 捕获;此处提示退化
    // eslint-disable-next-line no-console
    console.warn(`[vibe] 未知 visual.type="${type}",已退化为 ${fallbackType}(scene ${scene.id || "?"})`);
  }
  return TEMPLATES[fallbackType];
}
