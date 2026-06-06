// _base 模板注册表:visual.type → 通用参数化组件。
// 这是「通用层」——任何风格都先回退到这里;风格只在 styles/<id>/ 里覆盖真正长得不一样的那几个。
// ⚠️ Remotion bundle 静态分析 import:这里全是显式静态 import + 对象注册表,
//    绝不用动态变量路径(import(`./${T}`)),否则打包器找不到、渲染会 404。
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

// 通用层注册表(键 = storyboard 里的 visual.type)。解析器以此为 fallback 基底。
export const BASE = {
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

// 兼容旧引用名(老 index 导出叫 TEMPLATES)。
export const TEMPLATES = BASE;

// 已警告过的未知类型集合(避免逐帧刷屏)
const warned = new Set();

// 旧入口:仅按 type 选基础模板(无风格覆盖)。保留以兼容历史调用。
// 新代码请用 templates/resolve.jsx 的 resolveTemplate(type, styleId)。
export function pickTemplate(scene = {}) {
  const type = scene?.visual?.type;
  const comp = BASE[type];
  if (comp) return comp;
  // 退化:有屏幕文字→Title(信息密度低但不空),否则 BgOnly(纯背景)
  const fallbackType = scene?.onScreenText ? "title" : "bg-only";
  if (type && !warned.has(type)) {
    warned.add(type);
    // 渲染期 console.warn 会被 onBrowserLog 捕获;此处提示退化
    // eslint-disable-next-line no-console
    console.warn(`[vibe] 未知 visual.type="${type}",已退化为 ${fallbackType}(scene ${scene.id || "?"})`);
  }
  return BASE[fallbackType];
}
