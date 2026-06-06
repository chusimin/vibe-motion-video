# 怎么给 skill 喂新视频 / 加新风格 / 加新类型(更新 SOP)

> 你日常只需做两件事:**① 把喜欢的参考视频丢给我 ② 拍板选哪个对标**。剩下的拆解、语义提炼、建组件、验证我来干。
> 本文是这套"拆解 → 填骨架 → 质量涨"闭环的标准流程。**全程不改架构,只往留好的插槽里填。**

## A. 加一个新风格(最常见,如 editorial-saas)

**你给我**:一个文件夹,放 5-15 条该风格的参考视频(本地 mp4 或 给我链接)。告诉我风格名(如 `editorial-saas`)。

**我来做**:
1. **拆解**:`vibemotion teardown <你的文件夹>` → 自动切镜 + 每镜三帧 + contact sheet + `shots.csv` + `_semantic_pass.md`(落在 `./teardowns/<名>/`)。
2. **语义 pass**(我用视觉看帧):看关键帧/contact sheet,提炼**反复出现的高级技法 + 为什么高级 + 配色/字体/动效性格** → 写进 `references/teardowns/<风格>/` 与 `docs/types/<类型>.md`。
3. **建风格包**(三件套,增量):
   - `presets/styles/<风格>.json` —— 配色/字体/缓动/treatment(token)。
   - `remotion/src/templates/styles/<风格>/*.jsx` —— **只为真正长得不一样的镜头**写覆盖组件(与 `_base/` 同款 props);在 `remotion/src/templates/resolve.jsx` 的 `STYLE_OVERRIDES['<风格>']` 静态注册。
   - (可选)`remotion/src/blocks/<风格>/` —— 整段精修的场景配方。
4. **验证**:`config init --style <风格>` 渲一条测试片,我抽帧对照参考迭代到神似,再 commit。

**你拿到**:一个新对标风格,以后 `--style <风格>` 即可调用。editorial-saas 就是这么来的(对照 ObiN,巨字开场/设备框/逐词强调,见 commit `ca32233`)。

## B. 加一个新类型(如 数据可视化 / 知识科普)

**你给我**:该类型的参考片 + 类型名(如 `data-viz`)。

**我来做**:
1. teardown + 语义 pass(同上)。
2. 写 `docs/types/<类型>.md`(照 `docs/types/_TEMPLATE.md`:结构公式/节奏/动效词汇/为什么高级/反 pattern)。
3. 写 `presets/structures/<类型>.json`(节拍带 `priority/min/ideal/max`,供密度拟合)。
4. 在 config schema 的 `outputType` 枚举加该类型;映射到已有或新建组件。
5. 验证 + commit。

## C. 只补一条参考(不建新风格)
`vibemotion teardown <视频>` → 我做语义 pass → 把提炼的原理补进 `motion-constitution.md` 或对应 `docs/types/<类型>.md`。攒够同风格的再升级成风格包。

## 纪律(别破坏架构)
- **先用 token 参数调,装不下才写覆盖组件**;先把 `_base` 做好,再按**真实拆解证据**加风格包,别凭空堆。
- 覆盖组件**必须和 `_base` 同款 props**、静态 import 注册(Remotion bundle 要静态可分析)。
- 质量优先,不追覆盖率:5 个吃透的对标帧 > 50 条走马观花。
- 已知小账:`resolver.mjs` 目前只把 `palette/fonts/radius/motion` 注入 `spec.tokens`;风格包若要用 `darkFrame/punchColors/treatment`,组件内自带常量即可(editorial-saas 就是),或日后扩展 resolver 透传。

## 一句话
**你负责"挑片 + 拍板",我负责"拆解 + 提炼 + 建包 + 验证"。** 每填一个风格/类型,对应的产出质量就升一档,架构一行不用动。
