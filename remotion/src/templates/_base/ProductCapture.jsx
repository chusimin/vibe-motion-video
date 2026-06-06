// ProductCapture —— 产品/录屏捕获:全屏媒体(视频/图)+ Ken Burns/zoom + 标注 callouts。
// media 由 VibeVideo 解析成可加载 URL(staticFile/http)后通过 scene.visual._mediaSrc 注入。
// callouts: [{ text, x, y, at? }] —— x/y 为 0..1 相对坐标,at 为出现秒(相对 scene 起点)。
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { useKenBurns, useEnter } from "../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../fonts.js";
import { withAlpha } from "../theme.js";

// 粗判媒体类型:扩展名优先。
function isVideoSrc(src) {
  return /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(src || "");
}

function Callout({ c, theme, safeArea, index }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { size, fonts, palette, accent } = theme;
  const atFrame = Math.round((c.at ?? 0.4 + index * 0.5) * fps);
  const s = spring({ frame: frame - atFrame, fps, config: { damping: 16, mass: 0.7, stiffness: 150 } });
  const opacity = interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" });
  const scale = interpolate(s, [0, 1], [0.7, 1]);
  // 相对坐标 → 像素,夹进安全区
  const px = interpolate(c.x ?? 0.5, [0, 1], [safeArea.left ?? 60, width - (safeArea.right ?? 60)]);
  const py = interpolate(c.y ?? 0.5, [0, 1], [safeArea.top ?? 60, height - (safeArea.bottom ?? 60)]);
  const ac = accent(index % 3);
  return (
    <div
      style={{
        position: "absolute",
        left: px,
        top: py,
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        padding: `${size.small * 0.5}px ${size.small * 0.9}px`,
        borderRadius: size.small * 0.6,
        background: withAlpha(palette.bg, 0.82),
        border: `3px solid ${ac}`,
        boxShadow: `0 8px 40px ${withAlpha("#000000", 0.45)}`,
        ...GLOBAL_TEXT_STYLE,
        fontFamily: fonts.body,
        fontWeight: 700,
        fontSize: size.small,
        color: palette.fg,
        whiteSpace: "nowrap",
        maxWidth: width * 0.7,
      }}
    >
      {c.text}
    </div>
  );
}

export default function ProductCapture({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const { size, fonts, palette } = theme;
  const v = scene.visual || {};
  const src = v._mediaSrc; // 由 VibeVideo 解析注入
  const kb = useKenBurns(v.motion || "ken-burns");
  const callouts = Array.isArray(v.callouts) ? v.callouts : [];
  const labelAnim = useEnter({ delay: 4, motion: theme.motion });
  const label = scene.onScreenText || "";

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, overflow: "hidden" }}>
      {/* 媒体层(全屏铺满 + Ken Burns) */}
      {src ? (
        <AbsoluteFill style={{ ...kb }}>
          {isVideoSrc(src) ? (
            <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          )}
        </AbsoluteFill>
      ) : (
        // 无媒体兜底:占位卡片(避免黑屏),提示这里应有录屏
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            background: `linear-gradient(135deg, ${withAlpha(theme.accent(0), 0.25)}, ${palette.bg})`,
          }}
        >
          <div
            style={{
              ...GLOBAL_TEXT_STYLE,
              fontFamily: fonts.display,
              fontWeight: 800,
              fontSize: size.h2,
              color: palette.fg,
              opacity: 0.5,
              textAlign: "center",
              padding: "0 8%",
            }}
          >
            {label || "产品演示"}
          </div>
        </AbsoluteFill>
      )}

      {/* 顶部暗角渐变,提升标注/字幕可读性 */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${withAlpha("#000000", 0.35)} 0%, transparent 22%, transparent 70%, ${withAlpha("#000000", 0.55)} 100%)`,
          pointerEvents: "none",
        }}
      />

      {/* 标题贴在安全区顶部(有 media 时) */}
      {src && label ? (
        <div
          style={{
            position: "absolute",
            top: safeArea.top ?? 60,
            left: safeArea.left ?? 60,
            right: safeArea.right ?? 60,
            ...labelAnim,
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: size.h3,
            lineHeight: 1.1,
            color: "#FFFFFF",
            textShadow: `0 2px 18px ${withAlpha("#000000", 0.6)}`,
          }}
        >
          {label}
        </div>
      ) : null}

      {/* 标注 */}
      {callouts.map((c, i) => (
        <Callout key={i} c={c} theme={theme} safeArea={safeArea} index={i} />
      ))}
    </AbsoluteFill>
  );
}
