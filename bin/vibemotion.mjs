#!/usr/bin/env node
// vibemotion —— 内容→视频 自动化流水线 CLI
// 机械活在这里(确定性);创意活由 agent 按 PLAYBOOK.md 写 JSON。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log, UserError } from "../src/lib/log.mjs";
import { Project, FILES, STEPS } from "../src/lib/project.mjs";

const pexec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../src");

function parseArgv(argv) {
  const flags = {}; const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) flags[body.slice(0, eq)] = body.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[body] = argv[++i];
      else flags[body] = true;
    } else positionals.push(a);
  }
  return { flags, positionals };
}

const ROUTES = {
  ingest: "ingest/index.mjs",
  brief: "ingest/brief.mjs",
  config: "config/index.mjs",
  concept: "concept/index.mjs",
  storyboard: "storyboard/index.mjs",
  voice: "voice/index.mjs",
  render: "render/index.mjs",
  assemble: "assemble/index.mjs",
  qa: "assemble/qa.mjs",
  export: "export/index.mjs",
};

async function cmdInit(ctx) {
  const name = ctx.flags.name || ctx.positionals[0];
  const proj = await Project.init({ baseDir: ctx.flags.dir || process.cwd(), name });
  log.ok(`项目已创建:${proj.dir}`);
  log.dim("下一步:vibemotion ingest <链接/文件/想法>");
  return proj;
}

async function cmdStatus(ctx) {
  const proj = await Project.resolve({ projectDir: ctx.flags.project });
  const s = await proj.readState();
  log.step("状态", `${s.name}  (${proj.dir})`);
  for (const step of STEPS) {
    const st = s.steps[step] || "pending";
    const mark = st === "done" ? "✓" : st === "active" ? "▸" : "·";
    log.raw(`  ${mark} ${step.padEnd(12)} ${st}\n`);
  }
  if (s.chunks?.length) {
    log.raw("\n  分段:\n");
    for (const c of s.chunks) log.raw(`    chunk ${c.index}: ${c.status}\n`);
  }
}

async function which(bin) {
  try { await pexec("which", [bin]); return true; } catch { return false; }
}

async function cmdDoctor() {
  log.step("doctor", "环境体检");
  const bins = ["node", "ffmpeg", "ffprobe", "yt-dlp", "whisper-cli"];
  for (const b of bins) {
    const ok = await which(b);
    (ok ? log.ok : log.warn)(`${b}: ${ok ? "OK" : "缺失"}`);
  }
  const keys = ["MINIMAX_API_KEY", "ELEVENLABS_API_KEY"];
  for (const k of keys) {
    (process.env[k] ? log.ok : log.dim)(`${k}: ${process.env[k] ? "已设置" : "未设置(配音时再给)"}`);
  }
}

function help() {
  log.raw(`
vibemotion —— 内容→视频 自动化流水线

用法: vibemotion <命令> [参数]

  init --name <名>          新建项目
  ingest <源> [--type ...]  ① 读取内容(链接/视频/代码/文章/想法)→ brief
  config [init|show]        ② 访谈 → config.json
  concept                   ③ 校验 2-3 方向
  storyboard [validate|plan]④ 分镜 IR + 15s 分段
  voice <list|synth|...>    ⑤ TTS 配音 + 字幕对齐
  render --chunk N | --all  ⑥ 分段渲染
  assemble                  ⑦ 合成 + QA
  qa                        ⑦ 单独体检
  export                    ⑧ 导出成片/字幕/音频
  status                    查看状态机
  doctor                    环境体检

详见 PLAYBOOK.md(8 步编排)。
`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const { flags, positionals } = parseArgv(rest);
  const ctx = { flags, positionals, log, SRC };

  try {
    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return help();
    if (cmd === "init") return void (await cmdInit(ctx));
    if (cmd === "status") return void (await cmdStatus(ctx));
    if (cmd === "doctor") return void (await cmdDoctor());

    const route = ROUTES[cmd];
    if (!route) { log.err(`未知命令: ${cmd}`); help(); process.exit(1); }

    const mod = await import(path.join(SRC, route));
    ctx.project = await Project.resolve({ projectDir: flags.project });
    await mod.default(ctx);
  } catch (e) {
    if (e instanceof UserError) { log.err(e.message); process.exit(1); }
    throw e;
  }
}

main();
