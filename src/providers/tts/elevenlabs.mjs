// ElevenLabs provider。
//   key: 环境变量 ELEVENLABS_API_KEY(请求头 xi-api-key)
// 合成(带字符级时间戳):
//   POST /v1/text-to-speech/{voiceId}/with-timestamps
//   响应:{ audio_base64, alignment:{characters[], character_start_times_seconds[], character_end_times_seconds[]} }
//   → 把字符级合并成词级(中文按字、英文按空格)。
// 列音色:GET /v1/voices → voices[]{voice_id,name,labels}。
import { writeBase64, probeDurationSec } from "../../voice/media.mjs";
import { isCJKChar } from "../../voice/text.mjs";

const API = "https://api.elevenlabs.io";
const DEFAULT_MODEL = "eleven_multilingual_v2";

function headers(apiKey, json = true) {
  const h = { "xi-api-key": apiKey };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

// 把 ElevenLabs 的字符级对齐合并成词级。
//   chars: string[]    每个元素是一个字符(可能是空格/标点)
//   starts/ends: number[]  与 chars 等长,单位秒
// 规则:CJK 字符各自成词;连续非空白非 CJK 聚成英文词;空格作分隔;标点黏到当前词。
function charsToWords(chars, starts, ends) {
  const words = [];
  let cur = null; // { text, startSec, endSec }
  const flush = () => { if (cur && cur.text.trim()) words.push(cur); cur = null; };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const s = Number(starts[i]);
    const e = Number(ends[i]);
    const sOk = Number.isFinite(s);
    const eOk = Number.isFinite(e);

    if (/\s/.test(ch)) { flush(); continue; }

    if (isCJKChar(ch)) {
      // CJK:单字成词
      flush();
      cur = { text: ch, startSec: sOk ? s : (words.at(-1)?.endSec ?? 0), endSec: eOk ? e : (sOk ? s : 0) };
      flush();
      continue;
    }

    // 拉丁/数字/标点:并入当前英文词
    if (!cur) cur = { text: "", startSec: sOk ? s : (words.at(-1)?.endSec ?? 0), endSec: eOk ? e : (sOk ? s : 0) };
    cur.text += ch;
    if (eOk) cur.endSec = e;
    else if (sOk) cur.endSec = s;
  }
  flush();

  // 清洗:保证单调、endSec≥startSec
  let prevEnd = 0;
  for (const w of words) {
    if (!Number.isFinite(w.startSec)) w.startSec = prevEnd;
    if (w.startSec < prevEnd) w.startSec = prevEnd;
    if (!Number.isFinite(w.endSec) || w.endSec < w.startSec) w.endSec = w.startSec;
    w.startSec = round3(w.startSec);
    w.endSec = round3(w.endSec);
    prevEnd = w.endSec;
  }
  return words;
}

function round3(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }

export default {
  id: "elevenlabs",

  async listVoices({ apiKey } = {}) {
    if (!apiKey) throw new Error("缺少 ELEVENLABS_API_KEY");
    const res = await fetch(`${API}/v1/voices`, { headers: headers(apiKey, false) });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`ElevenLabs /v1/voices HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    const arr = Array.isArray(j.voices) ? j.voices : [];
    return arr.map((v) => ({
      id: v.voice_id,
      name: v.name || v.voice_id,
      lang: v.labels?.language || v.fine_tuning?.language || undefined,
      gender: v.labels?.gender || undefined,
    }));
  },

  async synth({ apiKey, text, voiceId, speed = 1, outPath, model = DEFAULT_MODEL }) {
    if (!apiKey) throw new Error("缺少 ELEVENLABS_API_KEY");
    if (!voiceId) throw new Error("ElevenLabs 合成必须指定 voiceId(用 `voice list` 查)。");
    if (!text || !text.trim()) throw new Error("elevenlabs.synth: text 不能为空");

    const url = `${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;
    const body = {
      text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        // ElevenLabs 用 speed 调语速(部分模型支持);范围 0.7~1.2,夹一下
        speed: clampSpeed(speed),
      },
    };
    const res = await fetch(url, { method: "POST", headers: headers(apiKey), body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    const j = await res.json();
    const b64 = j.audio_base64;
    if (!b64) throw new Error("ElevenLabs 响应缺少 audio_base64。");
    await writeBase64(outPath, b64);

    // 优先 alignment(原文对齐);没有则 normalized_alignment
    const al = j.alignment || j.normalized_alignment;
    let words;
    if (al && Array.isArray(al.characters)) {
      words = charsToWords(
        al.characters,
        al.character_start_times_seconds || [],
        al.character_end_times_seconds || [],
      );
    }
    const durationSec = await probeDurationSec(outPath);
    // 收尾:把最后一个词 endSec 贴到真实时长(避免字符级对齐与解码时长的微小差)
    if (words && words.length && durationSec > 0) {
      if (words.at(-1).endSec > durationSec) words.at(-1).endSec = round3(durationSec);
    }

    return {
      audioPath: outPath,
      mime: "audio/mpeg",
      durationSec,
      words: words && words.length ? words : undefined,
      voiceId,
    };
  },
};

function clampSpeed(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.7, Math.min(1.2, n));
}
