# blocks/ —— 场景配方块（整段精修镜头，增量加，先别填）

`templates/` 放的是**原子组件**（一个 Stat、一个 Title）。
这里放**场景配方块**：把多个原子 + 精调动效/排版/分区组合成的**一整段精修镜头**——
即「拆解一条好视频后，提炼出的可复用好组合」。

> 两种粒度（见 `docs/architecture.md` §4）：**原子组件**（`templates/`）+ **场景配方块**（本目录）。
> 纪律：先把 `_base` 原子做好，再按**拆解出的真实证据**把好组合沉淀到这里。质量优先，不追数量。

## 什么时候放这里 vs 放 templates/styles/

- 只是「一个 type 在某风格下换皮」（比如 Bento 的 Stat 长得不一样）→ 放 `templates/styles/<风格>/<Type>.jsx`（原子覆盖）。
- 「一整段镜头的固定配方」（比如 Bento 的「三宫格数据墙」：标题 + 3 张卡片 + 错峰弹入 + 角标）
  ——它不是单个 type，而是一段成品镜头 → 放这里。

## 目录约定

```
blocks/<风格id>/<配方名>.jsx
```

- `<风格id>` = 该配方所属风格（与 `presets/styles/<风格id>.json`、`styleId` 同名）。
  风格无关的通用配方可放 `blocks/_base/`。
- `<配方名>` = 语义化镜头名：`BentoStatWall.jsx`、`KeynoteBigStatement.jsx`、`HeroProductReveal.jsx`…

## 组件契约

与模板同款 props，便于被分镜直接挑用：

```jsx
export default function BentoStatWall({ scene = {}, theme, safeArea, captionsReserve = 0 }) { ... }
```

内部可自由 import `_base` 原子、`../lib/anim.jsx` 的动画原语、`../theme.js` 的工具，自行编排子序列。
**响应式 + 动效性格**规则同模板：相对单位 + `SafeFrame`，缓动读 `theme.motion`。

## 怎么接进渲染

配方块是「成品镜头」，两种接法（按需，现都未启用）：

1. **当成一个 type 注册**：给它一个 `visual.type`（如 `bento-stat-wall`），在 `templates/resolve.jsx`
   的 `STYLE_OVERRIDES[<风格>]` 里登记，storyboard 用该 type 即可命中。
2. **被风格覆盖组件内部调用**：某个 `styles/<风格>/<Type>.jsx` 直接 import 并 return 这个配方。

同样：⚠️ 静态 import + 显式登记，不要动态变量路径（Remotion 打包器要求）。
