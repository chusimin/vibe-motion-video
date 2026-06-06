// Background —— 每个 scene 的背景层。解析 scene.bg(hex/渐变名/media)。
// media 类型:若 bg 指向已解析的素材 URL(scene._bgSrc),用 Img/OffthreadVideo 铺满 + 轻微缩放。
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo } from "remotion";
import { resolveBackground } from "./theme.js";
import { useKenBurns } from "./lib/anim.jsx";

function isVideoSrc(src) {
  return /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(src || "");
}

export default function Background({ scene = {}, theme }) {
  const bgSrc = scene._bgSrc; // VibeVideo 解析 media 型 bg 时注入
  const resolved = resolveBackground(scene.bg, theme.palette);
  const kb = useKenBurns("zoom-in");

  // media 背景
  if (bgSrc) {
    return (
      <AbsoluteFill style={{ backgroundColor: theme.palette.bg, overflow: "hidden" }}>
        <AbsoluteFill style={{ ...kb }}>
          {isVideoSrc(bgSrc) ? (
            <OffthreadVideo src={bgSrc} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Img src={bgSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          )}
        </AbsoluteFill>
        {/* 压暗一层保证前景文字可读 */}
        <AbsoluteFill style={{ background: "rgba(0,0,0,0.28)" }} />
      </AbsoluteFill>
    );
  }

  // 纯色 / 渐变
  return <AbsoluteFill style={{ background: resolved.css }} />;
}
