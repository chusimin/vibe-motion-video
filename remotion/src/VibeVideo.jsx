// VibeVideo —— 主合成。把 scenes(已时移到从 0 开始)按绝对 Sequence 摆放,
// 每镜:Background → 模板(按 visual.type)→ 入/出场转场 →(可选)Audio →(可选)Captions。
//
// props:
//   scenes        已时移的镜头数组(startSec 从 0 起)
//   config        config.json(分辨率/fps/style/captions 等)
//   safeArea      平台安全区 { top,bottom,left,right }
//   captionsMap   { [sceneId]: captionJson }  词级字幕(内容随 inputProps 传入)
//   assetBase     无用占位。素材以 public 相对路径注入 scene._mediaPath/_bgPath/_audioPath,
//                 本组件用 staticFile() 解析成 bundle 可加载的 URL(必须在浏览器侧调用)。
import React from "react";
import { AbsoluteFill, Sequence, Audio, staticFile } from "remotion";
import { buildTheme } from "./theme.js";
import { pickTemplate } from "./templates/index.jsx";
import Background from "./Background.jsx";
import Captions from "./Captions.jsx";
import SceneTransition from "./SceneTransition.jsx";

const round = (n) => Math.round(n);

// 把 render 命令注入的 public 相对路径(_mediaPath/_bgPath/_audioPath)就地解析成 staticFile URL。
// staticFile 只能在 bundle(浏览器)里调用,所以放在组件渲染期做。
function resolveAssets(scene) {
  const out = { ...scene };
  if (scene._mediaPath) out._mediaSrc = staticFile(scene._mediaPath);
  if (scene._bgPath) out._bgSrc = staticFile(scene._bgPath);
  if (scene._audioPath) out._audioSrc = staticFile(scene._audioPath);
  return out;
}

export default function VibeVideo({ scenes = [], config = {}, safeArea = {}, captionsMap = {} }) {
  const fps = config.fps || 30;
  const theme = buildTheme(config);
  const capCfg = config.captions || {};
  const capEnabled = capCfg.enabled !== false; // 默认开
  const capStyle = capCfg.style || "karaoke";
  const capMaxChars = config._captionMaxChars || 14;

  // 字幕带为前景内容预留的底部高度(让模板内容不与字幕重叠)。
  const captionsReserve = capEnabled ? Math.round((theme.size.caption || 52) * 2.2) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.bg }}>
      {scenes.map((rawScene, i) => {
        const scene = resolveAssets(rawScene);
        const from = round((scene.startSec || 0) * fps);
        const dur = Math.max(1, round((scene.durationSec || 1) * fps));
        const Template = pickTemplate(scene);
        const cap = captionsMap[scene.id];
        const audioSrc = scene._audioSrc; // staticFile 解析后的配音 URL
        const showCaptions = capEnabled && cap && (cap.words?.length || cap.text);

        return (
          <Sequence key={scene.id || i} from={from} durationInFrames={dur} name={`${scene.id || "scene"}:${scene.visual?.type || "?"}`}>
            {/* 转场包裹背景+前景(字幕/音频不参与转场,避免字幕被裁切/音频被淡变) */}
            <SceneTransition transitionIn={scene.transitionIn || "fade"} transitionOut={scene.transitionOut || "none"}>
              <Background scene={scene} theme={theme} />
              <Template scene={scene} theme={theme} safeArea={safeArea} captionsReserve={captionsReserve} />
            </SceneTransition>

            {/* 配音:scene 相对从 0 播放 */}
            {audioSrc ? <Audio src={audioSrc} /> : null}

            {/* 词级字幕:scene 相对时间,叠在最上层、安全区底部 */}
            {showCaptions ? (
              <Captions
                caption={cap}
                theme={theme}
                safeArea={safeArea}
                style={capStyle}
                maxCharsPerLine={capMaxChars}
              />
            ) : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
