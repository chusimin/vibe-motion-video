// MiniMax T2A v2 provider。
//   key:  环境变量 MINIMAX_API_KEY(Bearer)
//   group:环境变量 MINIMAX_GROUP_ID(拼到 URL 的 ?GroupId=)
// 合成:POST https://api.minimax.chat/v1/t2a_v2?GroupId=<group>
//   body: { model, text, voice_setting:{voice_id,speed}, audio_setting:{format:"mp3"} }
//   响应:JSON,data.audio 为十六进制字符串(format=mp3 时);base_resp.status_code==0 才成功。
// 注意:MiniMax 的字符级时间戳(extra_info / 字幕接口)不稳定,这里**不**返回 words,
//       一律交给 voice 命令用 whisper 强制对齐,保证字幕节奏来自真实音频。
import { writeHex, probeDurationSec } from "../../voice/media.mjs";

const SYNTH_URL = "https://api.minimax.chat/v1/t2a_v2";
const VOICE_URL = "https://api.minimax.chat/v1/get_voice";
const DEFAULT_MODEL = "speech-02-hd";

// 无法连接音色接口时的内置常用音色兜底(MiniMax 系统音色,id 为官方公开音色名)。
const BUILTIN_VOICES = [
  { id: "male-qn-qingse", name: "青涩青年(男)", lang: "zh-CN" },
  { id: "male-qn-jingying", name: "精英青年(男)", lang: "zh-CN" },
  { id: "male-qn-badao", name: "霸道少爷(男)", lang: "zh-CN" },
  { id: "female-shaonv", name: "少女(女)", lang: "zh-CN" },
  { id: "female-yujie", name: "御姐(女)", lang: "zh-CN" },
  { id: "female-chengshu", name: "成熟女性(女)", lang: "zh-CN" },
  { id: "female-tianmei", name: "甜美女性(女)", lang: "zh-CN" },
  { id: "presenter_male", name: "男主持", lang: "zh-CN" },
  { id: "presenter_female", name: "女主持", lang: "zh-CN" },
  { id: "audiobook_male_1", name: "有声书男声 1", lang: "zh-CN" },
  { id: "audiobook_female_1", name: "有声书女声 1", lang: "zh-CN" },
];

function authHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export default {
  id: "minimax",

  // 列音色:尝试官方 get_voice;失败或字段缺失则返回内置常用音色清单兜底。
  async listVoices({ apiKey, groupId } = {}) {
    if (!apiKey) throw new Error("缺少 MINIMAX_API_KEY");
    const url = groupId ? `${VOICE_URL}?GroupId=${encodeURIComponent(groupId)}` : VOICE_URL;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders(apiKey),
        body: JSON.stringify({ voice_type: "all" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const out = [];
      // 系统音色 / 复刻音色 / 训练音色等字段都尽量纳入
      const buckets = [
        ["system_voice", "voice_id", "voice_name"],
        ["voice_cloning", "voice_id", "description"],
        ["voice_generation", "voice_id", "description"],
        ["music_generation", "voice_id", "description"],
      ];
      for (const [key, idF, nameF] of buckets) {
        const arr = Array.isArray(j[key]) ? j[key] : [];
        for (const v of arr) {
          const id = v[idF] || v.voice_id;
          if (!id) continue;
          out.push({ id, name: v[nameF] || v.voice_name || id, lang: v.language || undefined });
        }
      }
      if (out.length) return out;
      // 接口通但没解析到音色 → 兜底
      return BUILTIN_VOICES;
    } catch {
      // 接口不可用 → 兜底常用清单,保证 agent 仍能选 voiceId
      return BUILTIN_VOICES;
    }
  },

  async synth({ apiKey, groupId, text, voiceId = "female-shaonv", speed = 1, outPath, model = DEFAULT_MODEL }) {
    if (!apiKey) throw new Error("缺少 MINIMAX_API_KEY");
    if (!groupId) throw new Error("缺少 MINIMAX_GROUP_ID(MiniMax 合成必须带 GroupId)");
    if (!text || !text.trim()) throw new Error("minimax.synth: text 不能为空");

    const url = `${SYNTH_URL}?GroupId=${encodeURIComponent(groupId)}`;
    const body = {
      model,
      text,
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        format: "mp3",
        sample_rate: 24000,
        bitrate: 128000,
        channel: 1,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`MiniMax T2A HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    const j = await res.json();
    const status = j?.base_resp?.status_code;
    if (status !== 0 && status !== undefined) {
      throw new Error(`MiniMax T2A 失败 status_code=${status}: ${j?.base_resp?.status_msg || ""}`);
    }
    const hex = j?.data?.audio;
    if (!hex || typeof hex !== "string") {
      throw new Error("MiniMax T2A 响应缺少 data.audio(十六进制音频)。");
    }
    await writeHex(outPath, hex);
    // 时长:优先 extra_info.audio_length(毫秒),否则用 ffprobe 取真值
    let durationSec;
    const ms = j?.extra_info?.audio_length;
    if (Number.isFinite(ms) && ms > 0) durationSec = ms / 1000;
    else durationSec = await probeDurationSec(outPath);

    return {
      audioPath: outPath,
      mime: "audio/mpeg",
      durationSec,
      // 不返回 words:MiniMax 字符级时间戳不稳定,交 whisper 对齐兜底
      voiceId,
    };
  },
};
