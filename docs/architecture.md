# 架构:一个 skill 如何适配多种需求

> 本文是 vibe-motion-video 的设计宪法。所有新功能/重构都照此走。
> 一句话:**别给每种组合写规则——把维度当正交的乐高块,各选一个、自动拼。**

## 1. 维度正交,不相乘
每个维度只决定输出的「一个切片」,互不重叠。查这张表决定"这事归谁管":

| 维度 | 决定 | 不碰 |
|---|---|---|
| 类型 type | 结构(节拍)、节奏、动效词汇、用哪些模板 | 颜色/字体 |
| 风格 style | 设计 token(配色/字体/圆角/**动效性格**/背景)+ 可选模板覆盖 | 结构 |
| 平台 platform | 画幅/分辨率/fps/安全区/字幕样式/响度/Hook时机 | 内容 |
| 时长 duration | 密度预算(几个节拍、几个功能、停留时长) | look |
| 品牌 brand | 覆盖配色/字体/logo(**最高优先级**) | 结构 |
| 配音/字幕 | 开关 + 字幕时间来源 | — |

## 2. Resolver:选择 → RenderSpec(逻辑只放一处)
所有合并只在 `src/lib/resolver.mjs`。优先级:**品牌 > 风格 > 类型默认 > 全局默认**。
产物是无歧义的"施工图" RenderSpec,模板只读它(不认识 "douyin"/"bento"):

```
用户选择(type,style,platform,duration,brand,vo) → 加载预设
        → [Resolver] 合并 + 跑唯二交互函数 → RenderSpec:
   format: {w,h,fps,safeArea,captionStyle}          ← platform
   tokens: {bg,fg,accent[],fontDisplay,radius}      ← style ⊕ brand 覆盖
   motion: {personality,spring,tracking,stagger}    ← style
   styleId:'bento'                                  ← 供模板解析挑变体
   beats:  [{role,sec,template},...]                ← type ⊕ duration(已拟合)
   layout: {columns,anchor}                         ← type ⊕ aspect(已响应)
```
**纪律:模板永不读原始选择,只读 RenderSpec。** 加新平台/风格 = 加一个预设文件,不动模板。

## 3. 唯二的「真交互」——是函数,不是组合表
1. **密度拟合(类型 × 时长)**:结构预设每个节拍带 `priority + min/ideal/maxSec`;Resolver 按预算塞节拍、在区间内缩放。→ 一个 showreel 预设通吃 15/30/60s。
2. **响应式布局(类型 × 画幅)**:模板像网页响应式声明相对布局,同一镜头自动 reflow 适配 16:9 / 9:16。→ 不用每画幅一套模板。

半交互:**风格 × 类型 = 动效性格**——类型决定"放个数字滚动",风格决定"沉稳弹出还是脆生砸出"。组件读 `motion.personality`。

## 4. 风格包 Style Pack(支持「按风格存模板」)
一个风格 = **三件套打包**,增量式,绝不 type×style 爆炸:
- **token**:`presets/styles/<风格>.json`(配色/字体/缓动/动效性格)
- **组件覆盖(可选)**:`remotion/src/templates/styles/<风格>/<Type>.jsx`,只放这风格真正长得不一样的
- **场景配方(可选)**:`remotion/src/blocks/<风格>/`,整段精修好的镜头积木

**模板解析(override + fallback):**
```
resolveTemplate(type, styleId) =
   templates/styles/<styleId>/<Type>.jsx  若存在
   否则 templates/_base/<Type>.jsx        通用参数化版
```
两种粒度:**原子组件**(Stat/Title)+ **场景配方块**(一整段组合)。
**纪律**:① 先用 token 参数调,装不下才存覆盖模板;② 先把 `_base` 做好,再按**拆解出的真实证据**往风格包加(见 docs/showreel-craft.md 与拆解流程)。质量优先,不追覆盖率。

## 5. 与类型 Playbook / 拆解的关系
- **类型 Playbook**(`docs/types/<类型>.md`)→ 喂 `presets/structures/`(结构/节奏/动效词汇)。
- **拆解 Teardown** → 喂**风格包**(组件覆盖 + 场景配方)和**动效性格**(style token)。
- 本架构是**骨架**,Playbook/拆解是往骨架里填的**好品味数据**。

## 5.5 素材需求:脚本要真素材时,显式找用户补(「只用真货」的执行机制)
当分镜需要真实素材(logo/截图/产品图/b-roll)且有规格要求时,**不编造、不硬塞占位**,而是列清单让用户补:
- **自动先行**:ingest 已抓到的(logo/示例图/截图)自动绑定到对应镜头,只问真缺的,别让用户白干。
- **清单要具体**:每个素材给「用途(哪个镜头)+ 规格(格式/尺寸/透明/画幅)+ 放哪(`assets/<name>`)+ 替代方案」。规格含糊 = 浪费用户时间。
- **给替代方案,不只是索取**:每个缺口给选项 ① 你提供 ② 我自动录屏(产品页 Playwright)③ 库存图(Pexels)④ 改用纯动效、不需要素材。
- **它是一道闸门**:storyboard 之后、渲染之前;有「必需」素材没补齐就停下问,不静默渲占位。
- **校验**:用户放进来后,检查格式/尺寸/透明/画幅是否达标,不达标给提示。
- **落地**:新命令 `vibemotion assets`(扫需求 → 自动绑定 → 出缺口清单 → 校验 → 放行);素材规格作为可选字段 `scene.visual.assetReq` 进 storyboard schema。

## 6. 目标目录结构
```
src/lib/resolver.mjs            ★ 选择→RenderSpec(逻辑唯一出口)         [待建]
presets/
  platforms/ structures/ styles/   三个正交维度(structures 加 priority/min/max) [部分待补]
remotion/src/templates/
  _base/        <Type>.jsx       通用参数化模板(现有 11 个迁来)          [待迁]
  styles/<风格>/<Type>.jsx       风格覆盖,增量加                          [后期]
remotion/src/blocks/<风格>/      场景配方块,增量加                        [后期]
docs/
  architecture.md(本文) motion-constitution.md showreel-craft.md types/*  [部分待建]
references/teardowns/<类型>/     拆解卡沉淀                                 [后期]
```

## 7. 现状 vs 待办
- ✅ 已有:三个正交预设目录、config.json 收齐所有维度、config init 已做部分合并、11 个基础模板。
- 🔜 第一步:抽出显式 `resolver.mjs` + 密度拟合(structures 加 priority/min/max),RenderSpec 带 styleId。
- 🔜 随后:模板目录 `_base/` 化 + 模板解析器(override/fallback)+ 响应式布局。
- 🔜 素材需求闸门:`vibemotion assets`(ingest 自动绑定 + 缺口清单 + 校验)+ storyboard schema 加 `visual.assetReq`。
- 🔮 后期:按拆解证据逐步加风格包(组件覆盖 + 场景配方)、类型 Playbook、Teardown 工具。
