// Root —— 注册唯一合成 VibeVideo。
// 维度(width/height/fps/durationInFrames)由 inputProps 里的 config + scenes 推导,
// 支持任意比例(9:16 / 16:9 / 1:1 / 4:5)。defaultProps 仅为 Studio 预览兜底。
import React from "react";
import { Composition } from "remotion";
import VibeVideo from "./VibeVideo.jsx";

const round = (n) => Math.round(n);

// 从 props 推导合成元数据。durationInFrames 优先用 config._durationSec(render 命令按 chunk 精确传),
// 否则用 scenes 末镜结尾,再否则用 totalDurationSec。
function deriveMetadata({ scenes = [], config = {} }) {
  const fps = config.fps || 30;
  const width = config.resolution?.width || 1080;
  const height = config.resolution?.height || 1920;

  let durSec = config._durationSec;
  if (typeof durSec !== "number" || durSec <= 0) {
    if (scenes.length) {
      durSec = scenes.reduce((max, s) => Math.max(max, (s.startSec || 0) + (s.durationSec || 0)), 0);
    } else {
      durSec = config.durationTargetSec || 5;
    }
  }
  const durationInFrames = Math.max(1, round(durSec * fps));
  return { fps, width, height, durationInFrames };
}

export const Root = () => {
  return (
    <Composition
      id="VibeVideo"
      component={VibeVideo}
      // Studio 预览兜底:1 镜 3s 竖屏。真实渲染由 render 命令用 inputProps 覆盖。
      defaultProps={{
        scenes: [
          {
            id: "s01",
            startSec: 0,
            durationSec: 3,
            purpose: "preview",
            onScreenText: "VibeVideo 预览",
            visual: { type: "title" },
            bg: "brand.gradient.1",
            transitionIn: "fade",
          },
        ],
        config: {
          fps: 30,
          resolution: { width: 1080, height: 1920 },
          style: { preset: "kinetic-type", motion: "punchy", palette: { bg: "#0B0B0F", fg: "#FFFFFF", accent: ["#FFE600", "#FF2E63", "#08D9D6"] } },
          captions: { enabled: false },
        },
        safeArea: { top: 120, bottom: 320, left: 60, right: 120 },
        captionsMap: {},
      }}
      calculateMetadata={({ props }) => {
        const meta = deriveMetadata(props);
        return {
          ...meta,
          props,
        };
      }}
    />
  );
};
