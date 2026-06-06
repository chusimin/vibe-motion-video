// 文件态状态机:一个视频项目 = 一个目录。所有阶段产物落盘,可断点续跑。
import { promises as fs } from "node:fs";
import path from "node:path";
import { UserError } from "./log.mjs";

export const FILES = {
  state: "STATE.json",
  brief: "brief.json",
  briefRaw: "00_input/brief.raw.json",
  config: "config.json",
  concepts: "concepts.json",
  storyboard: "storyboard.json",
};

export const DIRS = {
  input: "00_input",
  assets: "05_assets",
  audio: "05_assets/audio",
  captions: "05_assets/captions",
  music: "05_assets/music",
  renders: "06_renders",
  final: "07_final",
};

const STEPS = ["ingest", "brief", "config", "concept", "storyboard", "voice", "render", "assemble", "export"];

function nowISO() {
  // 注意:脚本里允许用 Date(CLI 真实运行,不在 workflow 沙箱)
  return new Date().toISOString();
}

function slugify(s) {
  return (s || "video")
    .toString().trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "video";
}

export class Project {
  constructor(dir) {
    this.dir = path.resolve(dir);
  }

  p(...rel) { return path.join(this.dir, ...rel); }

  async exists() {
    try { await fs.access(this.p(FILES.state)); return true; } catch { return false; }
  }

  static async init({ baseDir = process.cwd(), name } = {}) {
    const slug = slugify(name);
    const root = path.join(path.resolve(baseDir), "vibe-projects");
    let dir = path.join(root, slug);
    // 避免覆盖同名项目
    let i = 2;
    while (true) {
      try { await fs.access(dir); dir = path.join(root, `${slug}-${i++}`); }
      catch { break; }
    }
    const proj = new Project(dir);
    await fs.mkdir(proj.dir, { recursive: true });
    for (const d of Object.values(DIRS)) await fs.mkdir(proj.p(d), { recursive: true });
    const state = {
      name: name || slug,
      slug,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      phase: "ingest",
      steps: Object.fromEntries(STEPS.map((s) => [s, "pending"])),
      chunks: [],
    };
    await proj.writeJSON(FILES.state, state);
    return proj;
  }

  // 解析当前项目:--project > $VIBE_PROJECT > cwd(若是项目) > ./vibe-projects 下唯一项目
  static async resolve({ projectDir } = {}) {
    const candidates = [];
    if (projectDir) candidates.push(projectDir);
    if (process.env.VIBE_PROJECT) candidates.push(process.env.VIBE_PROJECT);
    candidates.push(process.cwd());
    for (const c of candidates) {
      const proj = new Project(c);
      if (await proj.exists()) return proj;
    }
    // 自动发现 ./vibe-projects 下的项目
    const root = path.join(process.cwd(), "vibe-projects");
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const projs = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const proj = new Project(path.join(root, e.name));
        if (await proj.exists()) projs.push(proj);
      }
      if (projs.length === 1) return projs[0];
      if (projs.length > 1) {
        // 取最近更新的
        const withTime = await Promise.all(projs.map(async (p) => ({ p, t: (await p.readState()).updatedAt || "" })));
        withTime.sort((a, b) => (a.t < b.t ? 1 : -1));
        return withTime[0].p;
      }
    } catch { /* no vibe-projects dir */ }
    throw new UserError("找不到项目。先运行 `vibemotion init --name <名字>`,或用 --project <目录> 指定。");
  }

  async readJSON(rel) {
    const txt = await fs.readFile(this.p(rel), "utf8");
    return JSON.parse(txt);
  }

  async readJSONSafe(rel) {
    try { return await this.readJSON(rel); } catch { return null; }
  }

  async writeJSON(rel, obj) {
    await fs.mkdir(path.dirname(this.p(rel)), { recursive: true });
    await fs.writeFile(this.p(rel), JSON.stringify(obj, null, 2) + "\n", "utf8");
    return obj;
  }

  readState() { return this.readJSON(FILES.state); }

  async patchState(patch) {
    const s = await this.readState();
    const next = { ...s, ...patch, updatedAt: nowISO() };
    await this.writeJSON(FILES.state, next);
    return next;
  }

  async setStep(step, status) {
    const s = await this.readState();
    s.steps[step] = status;
    s.updatedAt = nowISO();
    if (status === "done") {
      const idx = STEPS.indexOf(step);
      if (idx >= 0 && idx + 1 < STEPS.length) s.phase = STEPS[idx + 1];
    }
    await this.writeJSON(FILES.state, s);
    return s;
  }
}

export { STEPS, slugify };
