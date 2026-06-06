// VibeVideo —— 主合成。把 scenes(已时移到从 0 开始)按绝对 Sequence 摆放,
// 每镜:Background → 模板(按 visual.type + styleId 解析)→ 入/出场转场 →(可选)Audio →(可选)Captions。
//
// 读取优先级:**优先读 inputProps.spec(RenderSpec,施工图)**;spec 缺失时**回退**现有 config/safeArea
// (向后兼容,保证老路径不破)。模板永远只读 theme + safeArea + scene,不认识 "douyin"/"bento"。
//
// props:
//   scenes        已时移的镜头数组(startSec 从 0 起)
//   spec          RenderSpec:{ styleId, format, tokens, motion }(Resolver 产出;可缺省)
//   config        config.json(分辨率/fps/style/captions 等;spec 缺失时的兜底来源)
//   safeArea      平台安全区 { top,bottom,left,right }(spec.format.safeArea 缺失时兜底)
//   captionsMap   { [sceneId]: captionJson }  词级字幕(内容随 inputProps 传入)
import React from "react";
import { AbsoluteFill, Sequence, Audio, staticFile } from "remotion";
import { buildTheme, buildThemeFromSpec, justifyForAnchor } from "./theme.js";
import { resolveTemplate } from "./templates/resolve.jsx";
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
  // ProductCapture 读 visual._mediaSrc;把解析好的媒体 URL 也补进 visual,避免改模板取值口径。
  if (out._mediaSrc) out.visual = { ...(out.visual || {}), _mediaSrc: out._mediaSrc };
  return out;
}

export default function VibeVideo({ scenes = [], spec = null, config = {}, safeArea = {}, captionsMap = {} }) {
  // ── 选型:有 spec 走 spec 路径;否则回退 config(向后兼容) ──
  const hasSpec = spec && typeof spec === "object" && (spec.tokens || spec.format || spec.motion);
  const theme = hasSpec ? buildThemeFromSpec(spec) : buildTheme(config);
  const styleId = hasSpec ? spec.styleId || null : config.style?.preset || null;

  // fps:spec.format.fps 优先,否则 config.fps,否则 30。
  const fps = (hasSpec && spec.format?.fps) || config.fps || 30;

  // 安全区:spec.format.safeArea 优先,否则外部 safeArea(平台预设),否则默认。
  const effSafeArea =
    (hasSpec && spec.format?.safeArea) ||
    (safeArea && (safeArea.top != null || safeArea.bottom != null) ? safeArea : null) ||
    { top: 60, bottom: 60, left: 60, right: 60 };

  // 字幕开关与样式:spec.format.captionStyle 优先,否则 config.captions。
  const capCfg = config.captions || {};
  const capEnabled = capCfg.enabled !== false; // 默认开
  const capStyle = (hasSpec && spec.format?.captionStyle) || capCfg.style || "karaoke";
  const capMaxChars =
    (safeArea && safeArea._maxCharsPerLine) || config._captionMaxChars || 14;

  // 字幕带为前景内容预留的底部高度(让模板内容不与字幕重叠)。
  const captionsReserve = capEnabled ? Math.round((theme.size.caption || 52) * 2.2) : 0;

  // 响应式:由画幅锚点决定主体竖直落位(竖屏偏下、横/方居中),透传给模板。
  const justify = justifyForAnchor(theme.layout?.anchor);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.bg }}>
      {scenes.map((rawScene, i) => {
        const scene = resolveAssets(rawScene);
        const from = round((scene.startSec || 0) * fps);
        const dur = Math.max(1, round((scene.durationSec || 1) * fps));
        // 模板解析:风格覆盖 → _base → bg-only 兜底(scene 供未知 type 智能兜底)。
        const Template = resolveTemplate(scene.visual?.type, styleId, scene);
        const cap = captionsMap[scene.id];
        const audioSrc = scene._audioSrc; // staticFile 解析后的配音 URL
        const showCaptions = capEnabled && cap && (cap.words?.length || cap.text);

        return (
          <Sequence key={scene.id || i} from={from} durationInFrames={dur} name={`${scene.id || "scene"}:${scene.visual?.type || "?"}`}>
            {/* 转场包裹背景+前景(字幕/音频不参与转场,避免字幕被裁切/音频被淡变) */}
            <SceneTransition transitionIn={scene.transitionIn || "fade"} transitionOut={scene.transitionOut || "none"}>
              <Background scene={scene} theme={theme} />
              <Template
                scene={scene}
                theme={theme}
                safeArea={effSafeArea}
                captionsReserve={captionsReserve}
                justify={justify}
              />
            </SceneTransition>

            {/* 配音:scene 相对从 0 播放 */}
            {audioSrc ? <Audio src={audioSrc} /> : null}

            {/* 词级字幕:scene 相对时间,叠在最上层、安全区底部 */}
            {showCaptions ? (
              <Captions
                caption={cap}
                theme={theme}
                safeArea={effSafeArea}
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
