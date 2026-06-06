// mock TTS provider —— 无需任何 key,用于离线测试整条配音/对齐/回写链路。
// 按文本长度估时长(中文≈5字/秒、英文≈3词/秒,受 speed 影响),用 ffmpeg 生成等长静音 mp3,
// 并直接给出"按字符权重均匀分布"的词级时间戳(provider 自带 words → voice 命令就不会再跑 whisper)。
import { writePlaceholderMp3, probeDurationSec } from "../../voice/media.mjs";
import { estimateDurationSec, distributeWordsUniform } from "../../voice/text.mjs";

// 内置"音色"清单(纯占位,便于 `voice list --provider mock` 与 preview 跑通)。
const VOICES = [
  { id: "mock-female", name: "Mock 女声", lang: "zh-CN", gender: "female" },
  { id: "mock-male", name: "Mock 男声", lang: "zh-CN", gender: "male" },
  { id: "mock-en", name: "Mock English", lang: "en-US", gender: "neutral" },
];

export default {
  id: "mock",

  // mock 不需要 key
  async listVoices() {
    return VOICES;
  },

  async synth({ text, voiceId = "mock-female", speed = 1, outPath }) {
    if (!text || !text.trim()) {
      throw new Error("mock.synth: text 不能为空");
    }
    // 1) 估时长 → 生成等长占位音频 mp3(极弱正弦,非纯静音)
    const estSec = estimateDurationSec(text, speed);
    await writePlaceholderMp3(outPath, estSec);
    // 2) 用 ffprobe 取真值(libmp3lame 实际写盘可能略有出入)
    const durationSec = await probeDurationSec(outPath);
    // 3) 直接给词级时间戳(均匀分布):voice 命令拿到 words 就不再走 whisper
    const words = distributeWordsUniform(text, durationSec);
    return {
      audioPath: outPath,
      mime: "audio/mpeg",
      durationSec,
      words,
      voiceId,
    };
  },
};
