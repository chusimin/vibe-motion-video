# templates/styles/ —— 风格覆盖组件(增量加，先别填）

这里放**某个风格真正长得不一样**的模板。绝大多数风格只靠 token（配色/字体/圆角/动效性格）就够了，
**不需要**在这里放任何东西。只有当「用 token 怎么调都装不出这风格的味道」时，才在这里写一个覆盖组件。

> 纪律（见 `docs/architecture.md` §4）：① 先用 token 参数调；装不下才存覆盖模板。② 先把 `_base` 做好，
> 再按**拆解出的真实证据**往这里加。质量优先，不追覆盖率。

## 目录约定

```
templates/styles/<风格id>/<Type>.jsx
```

- `<风格id>` = RenderSpec.styleId（与 `presets/styles/<风格id>.json` 同名，如 `bento`、`apple-keynote`）。
- `<Type>` = 模板组件名（首字母大写，对应 `visual.type`）：
  `Title` `Stat` `KineticText` `FeatureReveal` `BulletList` `Quote` `Comparison` `Cta` `LowerThird` `ProductCapture` `BgOnly`。

只放真正要换皮的那几个文件，其余 type 自动回退到 `_base/`。

## 组件契约（和 _base 完全一致，可直接拷一份改）

覆盖组件签名必须与 `_base` 同款，才能无缝替换：

```jsx
export default function BentoStat({ scene = {}, theme, safeArea, captionsReserve = 0 }) { ... }
```

- `scene`：当前镜头 IR（`onScreenText` / `visual.{type,value,label,items,...}` / `bg` 等）。
- `theme`：来自 `theme.js`，含 `palette`（bg/fg/accent[]）、`fonts`（display/body）、`motion`
  （`personality` 与 spring 参数：damping/mass/stiffness/enterShiftPx/speed/overshoot）、
  `size`（按画幅高度缩放好的字号梯度）、`accent(i)`、`fontScale`。
- `safeArea`：`{ top,bottom,left,right }`（已含画幅适配）。布局用 `SafeFrame`（`../../lib/anim.jsx`）包裹，
  内容自然落在安全区内。
- `captionsReserve`：底部要给字幕带留出的额外高度（透传给 `SafeFrame` 的 `extraBottom`）。

**响应式**：和 `_base` 一样，用相对单位 + `SafeFrame`，不要写死像素的整屏布局；
9:16 / 16:9 由 safeArea + 相对布局自动 reflow。**动效性格**：读 `theme.motion`（已映射 `personality`）调
缓动强度，别自己另立一套常量。

## 怎么注册（关键，唯一一步代码改动）

⚠️ Remotion bundle 用 Babel **静态分析** import，**不能**用动态变量路径
（`import(\`./styles/${id}/${T}\`)` 会被打包器漏掉 → 渲染期 404）。必须**显式静态 import + 写进映射表**。

在 `templates/resolve.jsx` 顶部 import，并在 `STYLE_OVERRIDES` 登记：

```jsx
import BentoStat from "./styles/bento/Stat.jsx";
import BentoTitle from "./styles/bento/Title.jsx";

export const STYLE_OVERRIDES = {
  bento: { stat: BentoStat, title: BentoTitle },   // 只覆盖这两个；其余 type 仍走 _base
};
```

- 外层键 = `styleId`；内层键 = `visual.type`（连字符写法，和 storyboard 一致：`kinetic-text` / `lower-third` / `bg-only`）。
- 解析顺序：`STYLE_OVERRIDES[styleId]?.[type]` → `_base[type]` → `_base['bg-only']`。
- 没登记的 type / 没覆盖的风格，**零成本**自动走 `_base`。
