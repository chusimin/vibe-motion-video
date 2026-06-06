// TTS provider 注册表 + 选择 + 凭据读取。
// 统一接口:每个 provider export default { id, listVoices({apiKey,groupId}), synth({...}) }。
import { UserError } from "../../lib/log.mjs";
import minimax from "./minimax.mjs";
import elevenlabs from "./elevenlabs.mjs";
import mock from "./mock.mjs";

export const PROVIDERS = {
  minimax,
  elevenlabs,
  mock,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

// 选 provider:显式 --provider > config.voiceover.provider > 默认 minimax。
// --mock 等价于 --provider mock。
export function pickProviderId({ flagProvider, mock: useMock, configProvider } = {}) {
  if (useMock) return "mock";
  const id = flagProvider || configProvider || "minimax";
  if (id === "none") {
    throw new UserError("config.voiceover.provider 为 none(未启用配音)。用 --provider 指定,或 --mock 测试。");
  }
  if (!PROVIDERS[id]) {
    throw new UserError(`未知 TTS provider "${id}"。可用:${PROVIDER_IDS.join(", ")}。`);
  }
  return id;
}

export function getProvider(id) {
  const p = PROVIDERS[id];
  if (!p) throw new UserError(`未知 TTS provider "${id}"。可用:${PROVIDER_IDS.join(", ")}。`);
  return p;
}

// 读取某 provider 的凭据(从环境变量),并在缺失时给出友好的、教用户怎么设的报错。
// mock 无需凭据。返回 { apiKey, groupId }。
export function readCredentials(id) {
  if (id === "mock") return {};
  if (id === "minimax") {
    const apiKey = process.env.MINIMAX_API_KEY;
    const groupId = process.env.MINIMAX_GROUP_ID;
    if (!apiKey) {
      throw new UserError(
        "未设置 MINIMAX_API_KEY。请先导出环境变量再重试:\n" +
        "      export MINIMAX_API_KEY=你的key\n" +
        "      export MINIMAX_GROUP_ID=你的GroupId   # MiniMax 合成必须\n" +
        "      (或用 --mock 离线测试整条链路)"
      );
    }
    return { apiKey, groupId };
  }
  if (id === "elevenlabs") {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new UserError(
        "未设置 ELEVENLABS_API_KEY。请先导出环境变量再重试:\n" +
        "      export ELEVENLABS_API_KEY=你的key\n" +
        "      (或用 --mock 离线测试整条链路)"
      );
    }
    return { apiKey };
  }
  return {};
}
