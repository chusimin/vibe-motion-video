// 步骤① ingest:把各种输入读成结构化原料 → 00_input/ + brief.raw.json
//   类型: url | video | code | article | script | idea
//   省 token 原则:视频先抓现成字幕,没有才本地 whisper 转写;绝不把视频/音频喂模型。
import { promises as fs } from "node:fs";
import path from "node:path";
import { UserError } from "../lib/log.mjs";
import { DIRS, FILES } from "../lib/project.mjs";
import {
  detectType, htmlToText, extractTitle, extractMetaDescription,
  subtitleToText, sh, hasBin, truncate, RAW_TEXT_LIMIT,
} from "./util.mjs";
import { buildCodeDigest } from "./codedigest.mjs";
import { collectAssetsFromDir, collectAssetsFromHtml } from "./assets-collect.mjs";

export default async function run(ctx) {
  const { project, flags, positionals, log } = ctx;
  const ref = positionals[0];
  if (!ref) {
    throw new UserError("用法:vibemotion ingest <链接/文件/目录/一句话想法> [--type url|video|code|article|idea|script]");
  }

  const type = await detectType(ref, flags.type);
  log.step("ingest", `读取内容(类型:${type})`);
  await project.setStep("ingest", "active");

  const ingestedAt = new Date().toISOString();
  let result;   // { title, rawText, meta, rawRef }

  switch (type) {
    case "url":     result = await ingestUrl(ref, project, log); break;
    case "video":   result = await ingestVideo(ref, project, log); break;
    case "code":    result = await ingestCode(ref, project, log); break;
    case "article": result = await ingestFile(ref, project, log, "article"); break;
    case "script":  result = await ingestFile(ref, project, log, "script"); break;
    case "idea":    result = await ingestIdea(ref, project, log); break;
    default:        throw new UserError(`未支持的类型:${type}`);
  }

  const briefRaw = {
    source: { type, ref, ingestedAt, ...(result.rawRef ? { rawRef: result.rawRef } : {}) },
    title: result.title || "",
    rawText: truncate(result.rawText || "", RAW_TEXT_LIMIT),
    meta: result.meta || {},
  };
  await project.writeJSON(FILES.briefRaw, briefRaw);
  await project.setStep("ingest", "done");

  log.ok(`原始素材已就绪 → ${path.join(DIRS.input, "brief.raw.json")}`);
  if (result.notes) for (const n of result.notes) log.warn(n);
  log.dim(`rawText ${briefRaw.rawText.length} 字符 · title: ${briefRaw.title || "(无)"}`);
  log.info("请阅读 00_input/brief.raw.json 后撰写 brief.json,再 `vibemotion brief` 校验。");
  return briefRaw;
}

// ---------------- url ----------------
async function ingestUrl(url, project, log) {
  log.info(`抓取网页:${url}`);
  let html;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        // 伪装常见浏览器 UA,降低被拦概率
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) throw new UserError(`HTTP ${res.status} ${res.statusText}`);
    const ctype = res.headers.get("content-type") || "";
    html = await res.text();
    if (!/html|xml|text/i.test(ctype) && !/<html/i.test(html)) {
      log.warn(`内容类型 ${ctype || "未知"} 似乎不是网页,仍尝试提取文本。`);
    }
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError(`抓取失败:${e.message}。检查链接是否可达,或改用 --type article 传入本地文件。`);
  }

  await fs.writeFile(project.p(DIRS.input, "source.html"), html, "utf8");
  const title = extractTitle(html);
  const desc = extractMetaDescription(html);
  const text = htmlToText(html);
  await fs.writeFile(project.p(DIRS.input, "source.txt"), text, "utf8");

  // 增量收集:从页面抽 logo/og:image/图片下载到 00_input/assets/(失败不致命)
  try { await collectAssetsFromHtml(html, url, project, log); } catch { /* 收集失败不阻断 ingest */ }

  const rawText = [
    title && `标题:${title}`,
    desc && `摘要:${desc}`,
    "",
    text,
  ].filter((x) => x !== undefined && x !== null).join("\n");

  return {
    title,
    rawText,
    rawRef: path.join(DIRS.input, "source.txt"),
    meta: {
      url,
      description: desc || undefined,
      htmlBytes: Buffer.byteLength(html),
      textChars: text.length,
    },
  };
}

// ---------------- video ----------------
async function ingestVideo(url, project, log) {
  if (!(await hasBin("yt-dlp"))) {
    throw new UserError("缺少 yt-dlp。请先安装(brew install yt-dlp)后重试。");
  }
  const inDir = project.p(DIRS.input);
  const notes = [];
  const meta = { url };

  // 1) 取元数据(title/duration/uploader)
  log.info("读取视频元数据(yt-dlp --dump-json)…");
  const dj = await sh("yt-dlp", ["--dump-json", "--no-warnings", "--skip-download", url], { timeoutMs: 1000 * 120 });
  let title = "";
  if (dj.code === 0 && dj.stdout.trim()) {
    try {
      const info = JSON.parse(dj.stdout.trim().split("\n")[0]);
      title = info.title || "";
      meta.title = info.title;
      meta.duration = info.duration;       // 秒
      meta.uploader = info.uploader || info.channel;
      meta.webpage_url = info.webpage_url || url;
      meta.extractor = info.extractor_key || info.extractor;
    } catch { /* 解析失败不致命 */ }
  } else {
    notes.push(`yt-dlp 取元数据失败(code ${dj.code})。可能是地域限制/需要登录,后续步骤可能受影响。`);
    if (dj.stderr) log.dim(firstLines(dj.stderr, 3));
  }

  // 2) 优先抓现成字幕(自动 + 人工,zh/en)
  log.info("尝试抓取现成字幕(yt-dlp --write-subs/--write-auto-subs)…");
  const subOut = path.join(inDir, "sub.%(ext)s");
  const subRes = await sh("yt-dlp", [
    "--write-auto-subs", "--write-subs",
    "--sub-langs", "zh.*,en.*",
    "--sub-format", "vtt",
    "--skip-download", "--no-warnings",
    "-o", subOut, url,
  ], { timeoutMs: 1000 * 180 });
  if (subRes.code !== 0 && subRes.stderr) log.dim(firstLines(subRes.stderr, 2));

  // 找下载到的 vtt 字幕文件
  const vtt = await findFirst(inDir, (n) => n.startsWith("sub.") && n.endsWith(".vtt"));
  if (vtt) {
    log.ok(`命中字幕:${path.basename(vtt)}`);
    const raw = await fs.readFile(vtt, "utf8");
    const transcript = subtitleToText(raw, "vtt");
    await fs.writeFile(path.join(inDir, "transcript.txt"), transcript, "utf8");
    meta.transcriptSource = "subtitles";
    meta.subtitleFile = path.basename(vtt);
    return {
      title,
      rawText: composeVideoRawText(title, meta, transcript),
      rawRef: path.join(DIRS.input, "transcript.txt"),
      meta,
      notes,
    };
  }

  // 3) 没字幕 → 下音频 + whisper 转写
  log.warn("未找到现成字幕,改为下载音频后本地转写(whisper-cli)。");
  const audioRes = await sh("yt-dlp", [
    "-x", "--audio-format", "mp3",
    "--no-warnings",
    "-o", path.join(inDir, "audio.%(ext)s"), url,
  ], { timeoutMs: 1000 * 60 * 20 });
  const audio = await findFirst(inDir, (n) => n.startsWith("audio.") && /\.(mp3|m4a|wav|ogg|flac|webm|opus)$/.test(n));
  if (audioRes.code !== 0 || !audio) {
    notes.push("音频下载失败,无法转写。请检查链接/网络,或手动提供字幕文件后用 --type script 导入。");
    if (audioRes.stderr) log.dim(firstLines(audioRes.stderr, 3));
    return {
      title,
      rawText: composeVideoRawText(title, meta, ""),
      meta,
      notes,
    };
  }
  meta.audioFile = path.basename(audio);

  const transcript = await transcribeWithWhisper(audio, inDir, log, notes, meta);
  if (transcript) {
    await fs.writeFile(path.join(inDir, "transcript.txt"), transcript, "utf8");
    meta.transcriptSource = "whisper";
    return {
      title,
      rawText: composeVideoRawText(title, meta, transcript),
      rawRef: path.join(DIRS.input, "transcript.txt"),
      meta,
      notes,
    };
  }

  // 转写失败(通常是模型缺失)→ 仍产出元数据,清晰提示
  return {
    title,
    rawText: composeVideoRawText(title, meta, ""),
    meta,
    notes,
  };
}

// whisper-cli 转写;返回 transcript 文本或 ""(失败时 push 到 notes)
async function transcribeWithWhisper(audioPath, inDir, log, notes, meta) {
  if (!(await hasBin("whisper-cli"))) {
    notes.push("缺少 whisper-cli,无法本地转写音频。安装:brew install whisper-cpp。");
    return "";
  }
  // 解析模型路径:env WHISPER_MODEL > 常见安装目录
  const model = await resolveWhisperModel();
  if (!model) {
    notes.push(
      "未找到 whisper ggml 模型,跳过转写。请下载一个 ggml 模型并指定路径:\n" +
      "      · 设环境变量 WHISPER_MODEL=/path/to/ggml-medium.bin(或 large-v3、small 等);\n" +
      "      · 或放到 ~/.cache/whisper.cpp/ggml-<size>.bin。\n" +
      "      下载示例:`curl -L -o ~/.cache/whisper.cpp/ggml-medium.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin`\n" +
      `      已成功获取视频元数据(标题/时长/作者),agent 可据此先行撰写 brief。`
    );
    return "";
  }
  meta.whisperModel = model;
  const outBase = path.join(inDir, "transcript");
  log.info(`本地转写中(whisper-cli,模型:${path.basename(model)})… 较长音频可能耗时数分钟。`);
  const r = await sh("whisper-cli", [
    "-m", model,
    "-f", audioPath,
    "-l", "auto",
    "-oj", "-otxt",
    "-np",
    "-of", outBase,
  ], { timeoutMs: 1000 * 60 * 30 });
  if (r.code !== 0) {
    notes.push(`whisper-cli 转写失败(code ${r.code})。${firstLines(r.stderr, 2)}`);
    return "";
  }
  // 读 txt 产物(whisper 会生成 transcript.txt)
  const txtPath = outBase + ".txt";
  try {
    const txt = await fs.readFile(txtPath, "utf8");
    return collapseTranscript(txt);
  } catch {
    // 退而求其次:从 json 拼
    try {
      const j = JSON.parse(await fs.readFile(outBase + ".json", "utf8"));
      const segs = (j.transcription || []).map((s) => (s.text || "").trim()).filter(Boolean);
      return collapseTranscript(segs.join("\n"));
    } catch {
      notes.push("whisper 已运行但未找到输出文件,转写为空。");
      return "";
    }
  }
}

// 探测 whisper ggml 模型路径
async function resolveWhisperModel() {
  const candidates = [];
  if (process.env.WHISPER_MODEL) candidates.push(process.env.WHISPER_MODEL);
  const home = process.env.HOME || "";
  const dirs = [
    path.join(home, ".cache/whisper.cpp"),
    path.join(home, "whisper.cpp/models"),
    "/opt/homebrew/share/whisper-cpp/models",
    "/usr/local/share/whisper.cpp/models",
  ];
  // 优先大模型(质量更好),再退而用小的
  const prefer = ["large-v3", "large-v2", "large", "medium", "small", "base", "tiny"];
  for (const d of dirs) {
    let names;
    try { names = await fs.readdir(d); } catch { continue; }
    const bins = names.filter((n) => /^ggml-.*\.bin$/.test(n));
    bins.sort((a, b) => modelRank(a, prefer) - modelRank(b, prefer));
    for (const b of bins) candidates.push(path.join(d, b));
  }
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch {}
  }
  return null;
}

function modelRank(name, prefer) {
  for (let i = 0; i < prefer.length; i++) if (name.includes(prefer[i])) return i;
  return prefer.length;
}

// ---------------- code ----------------
async function ingestCode(dir, project, log) {
  const abs = path.resolve(dir);
  let stat;
  try { stat = await fs.stat(abs); } catch { throw new UserError(`目录不存在:${abs}`); }
  if (!stat.isDirectory()) throw new UserError(`不是目录:${abs}(若是文件请用 --type article/script)。`);

  log.info(`分析代码目录:${abs}`);
  const digest = await buildCodeDigest(abs);
  await fs.writeFile(project.p(DIRS.input, "code-digest.md"), digest.markdown, "utf8");
  log.ok(`已生成代码摘要(约 ${digest.fileCount} 文件,关键文件 ${digest.keyFiles.length} 个)`);

  // 增量收集:从源码目录拷 logo/图片到 00_input/assets/(跳过 node_modules/>5MB,失败不致命)
  try { await collectAssetsFromDir(abs, project, log); } catch { /* 收集失败不阻断 ingest */ }

  return {
    title: digest.title,
    rawText: digest.markdown,
    rawRef: path.join(DIRS.input, "code-digest.md"),
    meta: {
      dir: abs,
      fileCount: digest.fileCount,
      keyFiles: digest.keyFiles,
      summary: digest.summary || undefined,
    },
  };
}

// ---------------- article / script ----------------
async function ingestFile(file, project, log, kind) {
  const abs = path.resolve(file);
  let content;
  try { content = await fs.readFile(abs, "utf8"); }
  catch (e) { throw new UserError(`读取文件失败:${abs}(${e.code || e.message})`); }

  log.info(`读取${kind === "script" ? "脚本/字幕" : "文章"}文件:${abs}`);
  const ext = path.extname(abs).toLowerCase();

  let rawText = content;
  let title = "";
  // 字幕格式 → 提纯
  if (ext === ".vtt" || ext === ".srt") {
    rawText = subtitleToText(content, ext.slice(1));
  } else {
    // markdown/txt:取首个标题行做 title
    const h = content.match(/^\s*#\s+(.+)$/m) || content.match(/^\s*(.+?)\s*$/);
    if (h) title = h[1].trim().slice(0, 120);
  }

  return {
    title,
    rawText,
    rawRef: path.relative(project.dir, abs).startsWith("..")
      ? undefined          // 文件在项目外,不记 rawRef(指向项目内才有意义)
      : path.relative(project.dir, abs),
    meta: {
      file: abs,
      ext,
      chars: content.length,
    },
  };
}

// ---------------- idea ----------------
async function ingestIdea(text, project, log) {
  const s = text.trim();
  log.info(`记录想法:${s.slice(0, 60)}${s.length > 60 ? "…" : ""}`);
  await fs.writeFile(project.p(DIRS.input, "idea.txt"), s + "\n", "utf8");
  return {
    title: s.length <= 40 ? s : "",
    rawText: s,
    rawRef: path.join(DIRS.input, "idea.txt"),
    meta: { chars: s.length },
  };
}

// ---------------- helpers ----------------
function composeVideoRawText(title, meta, transcript) {
  const head = [
    title && `标题:${title}`,
    meta.uploader && `作者:${meta.uploader}`,
    meta.duration && `时长:${fmtDuration(meta.duration)}`,
    meta.url && `链接:${meta.webpage_url || meta.url}`,
  ].filter(Boolean).join("\n");
  if (!transcript) {
    return head + "\n\n(未获取到字幕/转写文本——见上方提示。可凭元数据先行起草,或补充字幕后重跑。)";
  }
  return head + "\n\n## 转写文本\n" + transcript;
}

function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return String(sec);
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}分${s}秒`;
}

function collapseTranscript(s) {
  return s.replace(/\r/g, "")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function firstLines(s, n) {
  return (s || "").split("\n").filter(Boolean).slice(0, n).join(" | ");
}

async function findFirst(dir, pred) {
  let names;
  try { names = await fs.readdir(dir); } catch { return null; }
  names.sort();
  for (const n of names) if (pred(n)) return path.join(dir, n);
  return null;
}
