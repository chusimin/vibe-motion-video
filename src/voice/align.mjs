// 对齐兜底:当 provider 没给可靠词级时间戳时,产出平滑单调的词级时间戳。
//
// 策略(关键保证:字幕文字 == 已知脚本 text,节奏 == 音频真实时间):
//   1) 用 whisper-cli 对合成音频转写,取**段级**时间戳(-oj JSON 的 transcription[].offsets,毫秒)。
//      段级足够稳;我们不信任 whisper 的文字(ASR 可能与脚本不符),只用它的"时间分布"做节奏锚。
//   2) 按已知 text 切词(中文按字 / 英文按空格),用字符权重把词**比例切分**进各段时间区间,
//      得到单调不减、endSec≤durationSec 的词级时间戳。
//   3) 无 whisper 模型(或 whisper 失败)→ 退化为"按音频总时长均匀分布词",仍产出合法 captions,打 warn。
//
// 音频时长一律以 ffprobe 真值为准(传入 durationSec)。
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sh, hasBin, toWav16k } from "./media.mjs";
import { distributeWordsOverAnchors, distributeWordsUniform } from "./text.mjs";

// 探测 whisper ggml 模型路径:env WHISPER_MODEL > 常见安装目录(优先大模型)。
export async function resolveWhisperModel() {
  const candidates = [];
  if (process.env.WHISPER_MODEL) candidates.push(process.env.WHISPER_MODEL);
  const home = process.env.HOME || os.homedir() || "";
  const dirs = [
    path.join(home, ".cache/whisper.cpp"),
    path.join(home, "whisper.cpp/models"),
    "/opt/homebrew/share/whisper-cpp/models",
    "/usr/local/share/whisper.cpp/models",
  ];
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

// 跑 whisper 取段级时间锚。返回 [{ startSec, endSec, text }] 或 null(模型缺失/失败)。
// lang: "zh"|"en"|"auto" 之类;不传则 auto。
export async function whisperSegments(audioPath, { lang = "auto", log } = {}) {
  if (!(await hasBin("whisper-cli"))) {
    log?.warn?.("未找到 whisper-cli(brew install whisper-cpp),改用均匀分布兜底对齐。");
    return null;
  }
  const model = await resolveWhisperModel();
  if (!model) {
    log?.warn?.(
      "未找到 whisper ggml 模型,改用均匀分布兜底对齐(字幕节奏将退化)。\n" +
      "      设 WHISPER_MODEL=/path/to/ggml-medium.bin 或放到 ~/.cache/whisper.cpp/ 可获得真实节奏。"
    );
    return null;
  }

  // 转码到 16k 单声道 wav(whisper 友好;mp3 也支持但 wav 最稳)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-align-"));
  const wav = path.join(tmpDir, "in.wav");
  const outBase = path.join(tmpDir, "out");
  try {
    await toWav16k(audioPath, wav);
    const r = await sh("whisper-cli", [
      "-m", model,
      "-f", wav,
      "-l", lang || "auto",
      "-oj",
      "-np",
      "-of", outBase,
    ], { timeoutMs: 1000 * 60 * 15 });
    if (r.code !== 0) {
      log?.warn?.(`whisper-cli 对齐失败(code ${r.code}),改用均匀分布兜底。`);
      return null;
    }
    let j;
    try {
      j = JSON.parse(await fs.readFile(outBase + ".json", "utf8"));
    } catch {
      log?.warn?.("whisper 输出 JSON 解析失败,改用均匀分布兜底。");
      return null;
    }
    const segs = (j.transcription || [])
      .map((s) => {
        const from = s.offsets?.from;
        const to = s.offsets?.to;
        if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
        return { startSec: from / 1000, endSec: to / 1000, text: (s.text || "").trim() };
      })
      .filter((s) => s && s.endSec > s.startSec);
    if (!segs.length) {
      log?.warn?.("whisper 未产出有效段级时间戳(可能音频过短/静音),改用均匀分布兜底。");
      return null;
    }
    return segs;
  } finally {
    // 清理临时目录
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// 把语言代码收敛成 whisper 接受的简码(zh-CN→zh)。
function normLang(language) {
  if (!language) return "auto";
  const s = String(language).toLowerCase();
  if (s.startsWith("zh")) return "zh";
  if (s.startsWith("en")) return "en";
  if (s.startsWith("ja")) return "ja";
  if (s.startsWith("ko")) return "ko";
  return s.split(/[-_]/)[0] || "auto";
}

// 顶层:为一段已知 text + 已合成音频,产出词级时间戳。
//   - provider 已给 words → 直接清洗后返回(不跑 whisper)。
//   - 否则跑 whisper 段级 → 比例切分;失败则均匀分布。
// 返回 { words:[{text,startSec,endSec}], method:"provider"|"whisper"|"uniform" }。
export async function alignWords({ text, audioPath, durationSec, providerWords, language, log }) {
  // 1) provider 自带可靠 words:清洗(夹进 [0,durationSec]、单调)后采用
  if (Array.isArray(providerWords) && providerWords.length) {
    const cleaned = sanitizeWords(providerWords, durationSec);
    if (cleaned.length) return { words: cleaned, method: "provider" };
  }

  // 2) whisper 段级 → 比例切分
  const segs = await whisperSegments(audioPath, { lang: normLang(language), log });
  if (segs && segs.length) {
    const words = distributeWordsOverAnchors(text, segs, durationSec);
    if (words.length) return { words, method: "whisper" };
  }

  // 3) 均匀分布兜底
  const words = distributeWordsUniform(text, durationSec);
  return { words, method: "uniform" };
}

// 清洗 provider 词级:夹进 [0,total]、单调不减、endSec≥startSec、保留文字。
function sanitizeWords(words, total) {
  const T = Number(total) > 0 ? Number(total) : null;
  const out = [];
  let prevEnd = 0;
  for (const w of words) {
    const text = (w.text ?? "").toString();
    if (!text) continue;
    let s = Number(w.startSec);
    let e = Number(w.endSec);
    if (!Number.isFinite(s)) s = prevEnd;
    if (!Number.isFinite(e)) e = s;
    if (s < prevEnd) s = prevEnd;
    if (T != null) { s = Math.min(s, T); e = Math.min(e, T); }
    if (e < s) e = s;
    s = round3(Math.max(0, s));
    e = round3(Math.max(s, e));
    out.push({ text, startSec: s, endSec: e });
    prevEnd = e;
  }
  return out;
}

function round3(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
