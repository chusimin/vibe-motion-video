---
name: vibe-motion-video
description: 把任意内容自动做成视频的端到端流水线(Remotion 渲染)。当用户给出链接/视频链接/产品代码目录/文章/一句话想法/脚本,想产出「产品 showreel、产品介绍、知识科普、知识博主口播」等视频时触发。也适用于"帮我把这个做成视频""做个 showreel""把这篇文章做成科普视频""根据这个产品做个介绍视频"。强制 8 步工作流:①读取内容 ②拆解定调出 config ③给 2-3 方向选 ④分镜骨架 ⑤配音+字幕对齐 ⑥15s 分段逐段确认 ⑦合成体检 ⑧导出成片/字幕/音频。创意步骤 agent 写 JSON,机械步骤调 vibemotion CLI。
---

# vibe-motion-video

把内容自动做成视频。**完整规格见 [PLAYBOOK.md](./PLAYBOOK.md)——开始前务必通读。** 想理解「一个 skill 怎么适配类型/风格/平台/时长多种需求」,见 **[docs/architecture.md](./docs/architecture.md)**(正交维度 + Resolver + 风格包)。想**喂新参考视频 / 加新风格 / 加新类型**(拆解→建风格包→质量涨),见 **[docs/contributing.md](./docs/contributing.md)**;做 showreel 看 **[docs/types/showreel.md](./docs/types/showreel.md)** + 风格包 `editorial-saas`(对标 ObiN)。

## 一句话心法
**创意活你(agent)写 JSON,机械活调 `vibemotion` CLI。** 中间用渲染器无关的 JSON IR 当合约。每步落盘可续跑;③④⑥ 三道门必须等用户确认,别一口气跑完。

## 准备
```bash
SKILL=~/.../vibe-motion-video      # 本 skill 目录
node "$SKILL/bin/vibemotion.mjs" doctor   # 体检:ffmpeg/yt-dlp/whisper-cli/key
```
建议把 `vibemotion` 设为 `node "$SKILL/bin/vibemotion.mjs"` 的别名再操作。

## 8 步速查(细节看 PLAYBOOK)
1. `vibemotion init --name <名>` → `vibemotion ingest <源>` → 读 brief.raw.json,**你写 brief.json** → `vibemotion brief`
2. 与用户定调 → `vibemotion config init --type showreel --platform douyin --vo --captions`
3. **你写 concepts.json(2-3 方向)** → `vibemotion concept` → 🚩**让用户选一个**
4. **你写 storyboard.json(帧级精确分镜)** → `vibemotion storyboard validate && vibemotion storyboard plan` → 🚩**让用户确认分镜**
5. 若需配音:🚩**要 TTS key** → `vibemotion voice list` 选音色 → `vibemotion voice synth`(字幕从配音时间戳生成,100% 对齐)
6. `vibemotion render --chunk 0` → 🚩**给用户看 → OK 再渲下一段**;打回就改 scene 后 `--force` 重渲该段
7. `vibemotion assemble` → `vibemotion qa`(有红项就定位修复)
8. `vibemotion export` → 交付 07_final/(mp4 + srt + 音频 + manifest)

## 做 showreel 必读(质量与打法)
做产品 showreel 时,③④(分镜)和 ⑥⑦(渲染自审)务必对照 **[docs/showreel-craft.md](./docs/showreel-craft.md)**:
- **情绪曲线 痛→转→爽→燃**;60s 用「Hook→登场→★工作流演示(重头戏)→规模化payoff→CTA」结构(已编进 showreel 结构预设)。
- **反 slop 清单**:不许 emoji 当图标/俗气渐变/霓虹乱发光/AI 模板风;只用产品真实色板;标题够大够紧;前 3 秒抓人;对标 linear.app。
- **只用真货**:色板/文案/素材/工作流全取自真实产品,禁止编造占位。
- **审美由人把关**:每阶段先给图(渲 MP4 / `remotion still` 导帧)再迭代,Agent 给 80 分,最后 20 分靠用户挑刺。

两种模式:**CLI 流水线**(本 SKILL 8 步,自动化/多类型/可复现)与**导演模式**(单条 hero 片最高完成度,见 [references/showreel-director-prompt.md](./references/showreel-director-prompt.md))。可混用。

## 边界(v1)
- 渲染只用 Remotion;motion-graphics 优先(文字/图形/图表/产品录屏),暂不接 AI 生成视频/图。
- 首发精修 **产品 showreel · 9:16**;其余类型可跑,模板逐步补。
- 随时 `vibemotion status` 看进度。
