# PLAYBOOK —— vibe-motion-video 8 步编排 SOP

> 这是 agent(Claude Code / Codex)执行视频生成的操作手册。
> **核心原则:创意活由 agent 写 JSON,机械活调 `vibemotion` CLI。** 二者用渲染器无关的 JSON IR 做合约。
> 每步落盘、可断点续跑;③④⑥ 三道审批门必须等用户确认。

## 角色分工

| agent 做(创意,换谁都一样) | CLI 做(机械,确定性) |
|---|---|
| 读原始素材、理解重点、写 brief.json / concepts.json / storyboard.json、选音色、判断 QA | 抓取/转写、TTS+对齐、渲染、ffmpeg 合成、校验、导出 |

## 项目目录(每次生成一个)

```
vibe-projects/<slug>/
├─ STATE.json              # 状态机:phase / steps / chunks
├─ 00_input/               # ① 抓取到的原始素材 + brief.raw.json
├─ brief.json              # ① 拆解理解结果(agent 写,schema: brief)
├─ config.json            # ② 访谈结果(schema: config)
├─ concepts.json          # ③ 2-3 方向 + chosen
├─ storyboard.json        # ④ 分镜 IR(schema: storyboard)
├─ 05_assets/audio|captions|music/   # ⑤ 配音 + 词级时间戳字幕
├─ 06_renders/chunk-N.mp4 # ⑥ 分段渲染
└─ 07_final/              # ⑧ 成片 + srt + 音频 + manifest
```

---

## 步骤①  读取内容 → brief

**命令(机械):** `vibemotion ingest <源> [--type url|video|code|article|idea|script]`
- 自动判别类型;视频链接**先用 yt-dlp 抓现成字幕,没有才 whisper-cli 本地转写**(省 token,不把视频喂模型)。
- 网页抓正文;代码目录抽 README/关键文件/截图;文件直接读;一句话想法直接存。
- 产物:`00_input/`(原始)+ `00_input/brief.raw.json`(结构化原料)。

**agent(创意):** 阅读 `brief.raw.json`,提炼重点信息 → 写 `brief.json`(符合 brief schema:title/summary/keyPoints/valueProps/facts/audience)。
**校验:** `vibemotion brief`(校验 brief.json)。✅ 后 `STATE.steps.ingest/brief = done`。

## 步骤②  拆解定调 → config.json

**agent(创意):** 基于 brief 与用户对话,确定:产出类型 / 平台 / 风格 / 品牌 / 时长 / 是否配音 / 是否字幕 / **第一个镜头时长**。
**命令:** `vibemotion config init --type <showreel|...> --platform <douyin|...> [--duration 30] [--vo] [--captions]`
- 按平台/结构/风格预设解析默认值(分辨率/fps/安全区/响度等),生成 `config.json` 草稿。
- agent 按需改写细节后 `vibemotion config`(校验)。✅ 门槛低,无需用户额外确认。

## 步骤③  给 2-3 个方向(⚠️ 审批门)

**agent(创意):** 产出 `concepts.json`:`{ options:[{id,hook,angle,logline}], chosen:null }`,每个方向不同钩子+叙事角度。
**校验:** `vibemotion concept`。
**🚩 停下,把 2-3 个方向呈现给用户,让用户选 1 个。** 写回 `concepts.json.chosen`,再继续。

## 步骤④  分镜骨架 → storyboard.json(⚠️ 审批门)

**agent(创意):** 基于选定方向写 `storyboard.json`(storyboard schema):每个 scene 含 `startSec/durationSec/purpose/vo/onScreenText/visual{type,...}/bg/transition`。**时间帧级精确、相邻无缝、总时长 = config.durationTargetSec。** 开场 scene 时长 = config.firstSceneSec。
> 📐 **做 showreel 先读 [docs/showreel-craft.md](./docs/showreel-craft.md)**:按情绪曲线 痛→转→爽→燃 编排,工作流演示是重头戏;色板/文案/素材只用真货。
**命令:** `vibemotion storyboard validate`(校验时间连续性)→ `vibemotion storyboard plan`(按 chunkSec=15 切分段写入 `chunks`)。
**🚩 把分镜表(每镜目的/时长/画面/台词)呈现给用户确认,再继续。**

## 步骤④· 素材清单(若分镜需要真实素材,⚠️ 闸门)

若分镜里有镜头需要真实素材(logo/截图/产品图/b-roll)且有规格要求:
**命令:** `vibemotion assets`(扫描分镜素材需求 → 自动绑定 ingest 已抓到的 → 列出仍缺的清单 → 校验已补的)。
**🚩 把缺口清单呈现给用户**,每项写清「用途(哪个镜头)+ 规格(格式/尺寸/透明/画幅)+ 放哪(`assets/<name>`)+ 替代方案(你提供 / 我录屏 / 库存图 / 改纯动效)」。
**只用真货,不编造占位;必需素材没补齐不进渲染。** 用户补完 → 重跑 `vibemotion assets` 校验通过 → 继续。

## 步骤⑤  配音 + 字幕对齐(若 config.voiceover.enabled)

**🚩 让用户提供 TTS key**(`MINIMAX_API_KEY` 或 `ELEVENLABS_API_KEY`)。
**命令:**
- `vibemotion voice list --provider minimax` 列音色 → agent 帮用户选 voiceId(写回 config)。
- `vibemotion voice synth` 对每个 scene.vo 合成配音 → `05_assets/audio/<sceneId>.mp3`,并取词级时间戳(provider 自带或 whisper-cli 强制对齐)→ `05_assets/captions/<sceneId>.json`。
- **关键保证:字幕内容与节奏 100% 来自配音音频的真实时间戳,绝不手填。** 配音时长会回写 scene.durationSec(若超出则 agent 调整分镜)。

## 步骤⑥  15s 分段渲染(⚠️ 逐段审批门)

**命令:** `vibemotion render --chunk N`(渲染第 N 段 → `06_renders/chunk-N.mp4`)。
**循环:** 渲一段 → 打开给用户看 → 用户确认 OK 才渲下一段;有问题则 agent 改 storyboard 对应 scene → `vibemotion render --chunk N --force` 只重渲这一段。全部 `chunks[].status=approved` 才进⑦。
> 🎯 **每段对照 [docs/showreel-craft.md](./docs/showreel-craft.md) 的反 slop 清单自审**:无 emoji 图标/无俗气渐变/无霓虹乱发光/只用真实色板/标题够大够紧/前 3 秒抓人/关键信息有字幕。审美由用户把关,每段先给图再迭代。

## 步骤⑦  自动合成 + 体检

**命令:** `vibemotion assemble`(ffmpeg 拼接已批准分段 + 混音/配乐 ducking + 响度归一 -14LUFS + 字幕)→ `vibemotion qa`(ffprobe 抽帧检查:总时长、音画同步、字幕安全区、无溢出/错帧)。
QA 报告有红项 → agent 定位到 scene/chunk 修复重渲。

## 步骤⑧  导出完整内容

**命令:** `vibemotion export`(产 `07_final/`:成片 mp4、`final.srt`、`final.m4a` 音频、`manifest.json` 含每个素材 seed/prompt 可复现)。可选 `--aspect 16:9,1:1` 多比例导出。

---

## 状态与续跑
- `vibemotion status` 看状态机;任何一步可单独重跑(产物覆盖)。
- 失败安全:TTS/渲染失败有重试;分段渲染互不影响。
