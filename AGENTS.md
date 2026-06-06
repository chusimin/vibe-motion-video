# vibe-motion-video (Codex 入口)

把内容自动做成视频的 8 步流水线。**与 Claude Code 共用同一套 `vibemotion` CLI 与 IR,逻辑全在下面两份文件:**

- 操作手册:**[PLAYBOOK.md](./PLAYBOOK.md)**(8 步 SOP,开始前通读)
- 速查:[SKILL.md](./SKILL.md)
- 做 showreel 的打法:**[docs/showreel-craft.md](./docs/showreel-craft.md)**(情绪曲线 + 反 slop 清单 + 心法);单条 hero 片可走导演模式 [references/showreel-director-prompt.md](./references/showreel-director-prompt.md)

> ⚠️ Codex 环境:操作被沙箱拦截或需联网/审批授权时,**先停下告诉用户,别静默跳过**(见 craft 手册第 6 节)。

## 心法
创意活你写 JSON(brief / concepts / storyboard),机械活调 `vibemotion` CLI。中间用渲染器无关的 JSON IR 当合约。③④⑥ 三道审批门必须等用户确认。

## 起步
```bash
node bin/vibemotion.mjs doctor          # 体检
node bin/vibemotion.mjs init --name 演示  # 建项目
node bin/vibemotion.mjs help             # 命令总览
```
然后严格按 PLAYBOOK 的 ①→⑧ 执行。每步产物落 `vibe-projects/<slug>/`,`status` 看进度,任意步可重跑。
