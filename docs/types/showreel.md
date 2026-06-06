# 类型 Playbook:产品 Showreel

> 语义来源:拆解 7 条对标片(ObiN Studio / Bohdan Martovskyi / ARIA / Aftermagics / Varchasva ×2)。
> 通用手艺见 `../motion-constitution.md`;本文只写 showreel 独有。配套风格包:`editorial-saas`。

## 1. 用在哪
产品/工具/品牌的高密度集锦片。落地页 hero、社媒、pitch。15-60s。9:16 或 16:9。

## 2. 结构公式(5 段能量曲线)
| 段 | 时长占比 | 目标 | 选镜/做镜原则 | 能量 |
|---|---|---|---|---|
| 开场 建立记忆点 | 0-3s | 让人停手 | 巨型切边排版 / 最强图形帧,构图干净 | high |
| 风格铺陈 | 3-12s | 证明视觉语言 | 编辑体正文+强调词、品牌系统、抽象 motion、颜色变化 | low-med(慢留) |
| 产品展示 | 12-25s | 证明落地 | 设备框 UI / dashboard 透视 / 真实操作,medium | med |
| 高潮 | 25-38s | 制造密度 | **快切 0.6-1.2s**,强转场、强运动、满色 punch 帧 | high |
| 品牌落点 | 38-45s | 收口 | logo lockup / "Let's Work Together" / 干净结束帧 | low |

短片按比例压缩。和 `presets/structures/showreel.json` 的 `heroMode60s` 一致。

## 3. 节奏规则(★快是第一优先级 · montage 实测均长 1.7s/镜、79% 在 2s 内)
- **每镜很短**:默认 **1-1.5s/镜**;高潮段 0.6-1s 快切。**比"看着舒服"再快一档**。15s≈10-14 镜,30s≈20-26 镜。
- **镜头内持续运动**:几乎没有静止 hold —— 快进 overshoot(5-8 帧)→ 持续缩放/位移/形变 → 可快出;标记/sparkle/底纹也全程微动。(参考 ObiN:巨字"morph.network"横向高速扫过整屏)
- **字极少 + 大到出血**:每镜 **1-3 字/词**;巨字可切边;长台词拆成多个快镜逐词砸,别在一镜里放长句。
- **punch 闪帧节拍**:段间插 0.3-0.6s 整屏满色帧当重音(亮→暗→满色交替)。
- 留白单元素帧穿插换气,但也在动。

## 4. 动效词汇表(何时用 + 为什么高级)
| 招式 | 用在哪 | 为什么高级(可迁移原理) |
|---|---|---|
| 巨型切边排版 BigType | 开场/铺陈 | 大到出血 + 负字距,分量来自 typography 不是装饰 |
| 逐词强调换色 WordEmphasis | 铺陈 | 整句中性,唯一关键词换强调色/斜体 → 一帧一个焦点 |
| 设备框 + 3D 倾斜 DeviceFrame | 产品展示 | 真实 UI 进框 + 轻微透视/视差 → 可信、有体积 |
| dashboard 透视 | 产品展示 | UI 面板悬浮 3D 倾斜,紫调统一 → 科技感 |
| 满色 punch 帧 | 段间/高潮 | 整屏纯色定格当节拍重音 → 对比与呼吸 |
| 强转场(mask wipe / 光爆 / 色差) | 高潮 | 设计过的转场,不是淡入淡出;共享元素或冲击 |
| 干净落版 lockup | 收尾 | 大留白 + 单一品牌元素 → 高级感收口 |

## 5. 排版 / 颜色 / 层级
- 显示字:粗 grotesque,负字距 -0.03,可切边。正文:干净 sans。强调词:可斜体/换色。
- 颜色纪律:1 亮底 + 近黑字 + 1 主强调(紫)+ 1 火花色(绿),暗场/满色帧做对比。**强调色只给焦点**。
- 层级要狠:巨标题 vs 极小标签,不要都中等。

## 6. 声音 / 卡点
高潮段刀落鼓点;铺陈段留呼吸。无人声也要有节奏律动(可后期进剪映对拍)。

## 7. showreel 专属反 pattern
- 不要匀速堆功能(没有能量曲线 = 平)。
- 不要满屏都动(没有留白/重音 = 累)。
- 不要把产品 UI 平铺截图(进设备框/透视才有体积)。
- 强调色滥用 = 廉价;只给一处焦点。

## 8. 参考范例
见 `references/teardowns/showreel/`(ObiN/Bohdan/Varchasva 等 7 条,62 镜)。**ObiN = editorial-saas 风格包的主对标**。

## 9. 用到的组件 / 场景配方
风格包 `remotion/src/templates/styles/editorial-saas/`:BigTypeReveal(title)/ WordEmphasisKinetic(kinetic-text)/ DeviceFrame(product-capture)/ EditorialStat(stat)/ PunchBulletList(bullet-list)/ WorkTogetherOutro(cta)/ PunchFrame(bg-only)。
