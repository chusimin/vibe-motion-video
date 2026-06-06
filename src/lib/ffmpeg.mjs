// ffmpeg / ffprobe 公共封装。assemble / qa / export 共用。
// 通过 shell 调外部二进制(不引第三方 npm)。
import { execFile } from "node:child_process";
import { UserError } from "./log.mjs";

// 子进程封装:返回 { code, stdout, stderr, err };不抛(由调用方判定)。
// 默认 30 分钟超时、64MB 缓冲(loudnorm 两遍 + 抽帧不会触顶)。
export function sh(bin, args, { cwd, timeoutMs = 1000 * 60 * 30, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        err: err || null,
      });
    });
  });
}

// 探测命令是否存在
export async function hasBin(bin) {
  const r = await sh("which", [bin], { timeoutMs: 5000 });
  return r.code === 0 && r.stdout.trim().length > 0;
}

// 确保 ffmpeg / ffprobe 可用,缺失则抛 UserError
export async function ensureFfmpeg() {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    if (!(await hasBin(bin))) {
      throw new UserError(`缺少 ${bin}(ffmpeg 8.x)。请先安装:brew install ffmpeg`);
    }
  }
}

// 跑 ffmpeg,失败抛 UserError(附带 stderr 末尾若干行帮助定位)
export async function runFfmpeg(args, { label = "ffmpeg", timeoutMs } = {}) {
  const r = await sh("ffmpeg", args, { timeoutMs });
  if (r.code !== 0) {
    const tail = (r.stderr || "").trim().split("\n").slice(-12).join("\n");
    throw new UserError(`${label} 失败(exit ${r.code}):\n${tail}`);
  }
  return r;
}

// ffprobe 取媒体信息(format + streams),JSON 解析后返回。失败抛 UserError。
export async function probe(file) {
  const r = await sh("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  if (r.code !== 0) {
    const tail = (r.stderr || "").trim().split("\n").slice(-6).join("\n");
    throw new UserError(`ffprobe 读取失败:${file}\n${tail}`);
  }
  let json;
  try { json = JSON.parse(r.stdout); }
  catch { throw new UserError(`ffprobe 输出无法解析为 JSON:${file}`); }
  const video = (json.streams || []).find((s) => s.codec_type === "video") || null;
  const audio = (json.streams || []).find((s) => s.codec_type === "audio") || null;
  const durationSec = Number(
    json.format?.duration ?? video?.duration ?? audio?.duration ?? NaN
  );
  return { raw: json, format: json.format || {}, video, audio, durationSec };
}

// 解析 "30/1" 这类分数帧率为浮点
export function parseFps(str) {
  if (!str) return NaN;
  if (typeof str === "number") return str;
  const m = String(str).match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!m) return Number(str);
  const num = Number(m[1]);
  const den = m[2] !== undefined ? Number(m[2]) : 1;
  return den ? num / den : num;
}

// 从一段 ffmpeg/ffprobe 文本里抓某 filter 的指标。
// 例:matchNumber(text, /input_i:\s*(-?\d+(?:\.\d+)?)/) → 数字或 null
export function matchNumber(text, re) {
  const m = (text || "").match(re);
  return m ? Number(m[1]) : null;
}
