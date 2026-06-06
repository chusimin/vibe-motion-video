// voice 模块的媒体工具:子进程封装、ffprobe 取真实时长、ffmpeg 生成静音、采样率转码。
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { UserError } from "../lib/log.mjs";

// 子进程:返回 { code, stdout, stderr, err };不抛(调用方判定)。
export function sh(bin, args, { cwd, timeoutMs = 1000 * 60 * 10, maxBuffer = 64 * 1024 * 1024 } = {}) {
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

export async function hasBin(bin) {
  const r = await sh("which", [bin], { timeoutMs: 5000 });
  return r.code === 0 && r.stdout.trim().length > 0;
}

// 用 ffprobe 取音频真实时长(秒)。失败抛 UserError。
export async function probeDurationSec(file) {
  if (!(await hasBin("ffprobe"))) {
    throw new UserError("缺少 ffprobe(随 ffmpeg 安装:brew install ffmpeg),无法读取音频真实时长。");
  }
  const r = await sh("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const sec = parseFloat((r.stdout || "").trim());
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new UserError(`ffprobe 无法解析时长:${file}（${(r.stderr || "").split("\n")[0] || "未知错误"}）`);
  }
  return sec;
}

// 用 ffmpeg 生成一段指定时长的占位音频 mp3(mock provider 用)。
// 用极弱低频正弦(≈ -26dB)而非纯静音:让音轨"存在",从而能走通 loudnorm 两遍与 QA 音频检查;
// 真实 TTS 会替换它。仅测试用,音量很低基本不打扰。
export async function writePlaceholderMp3(outPath, durationSec) {
  if (!(await hasBin("ffmpeg"))) {
    throw new UserError("缺少 ffmpeg(brew install ffmpeg),mock provider 无法生成占位音频。");
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const dur = Math.max(0.3, Number(durationSec) || 0.3).toFixed(3);
  const r = await sh("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=196:sample_rate=24000",
    "-t", dur,
    "-af", "volume=0.05",
    "-c:a", "libmp3lame", "-q:a", "5",
    outPath,
  ]);
  if (r.code !== 0) {
    throw new UserError(`ffmpeg 生成占位音频失败(code ${r.code}):${(r.stderr || "").split("\n").slice(-3).join(" ")}`);
  }
  return outPath;
}

// 把任意音频转成 whisper 友好的 16k 单声道 wav,返回新路径。失败抛 UserError。
export async function toWav16k(srcPath, outPath) {
  if (!(await hasBin("ffmpeg"))) {
    throw new UserError("缺少 ffmpeg,无法为 whisper 转码音频。");
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const r = await sh("ffmpeg", ["-y", "-i", srcPath, "-ac", "1", "-ar", "16000", outPath]);
  if (r.code !== 0) {
    throw new UserError(`ffmpeg 转码 wav 失败(code ${r.code}):${(r.stderr || "").split("\n").slice(-3).join(" ")}`);
  }
  return outPath;
}

// 把 base64 音频写盘。
export async function writeBase64(outPath, b64) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, Buffer.from(b64, "base64"));
  return outPath;
}

// 把十六进制字符串(MiniMax 返回 audio 为 hex)写盘。
export async function writeHex(outPath, hex) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, Buffer.from(hex, "hex"));
  return outPath;
}
