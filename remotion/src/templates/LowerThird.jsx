// LowerThird —— 下三分之一字幕条:用于口播/人物介绍,贴在安全区下部(字幕带之上)。
// 不铺满全屏,作为叠加层;背景通常是录屏/人像(由 Background 或上层 ProductCapture 提供)。
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { GLOBAL_TEXT_STYLE } from "../fonts.js";
import { withAlpha } from "../theme.js";

export default function LowerThird({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const { motion, size, fonts, palette, accent } = theme;
  const v = scene.visual || {};
  const title = scene.onScreenText || v.value || "";
  const subtitle = v.subtitle || "";

  const s = spring({ frame: frame - 3, fps, config: { damping: 20, mass: motion.mass, stiffness: 140 } });
  const x = interpolate(s, [0, 1], [-width * 0.4, 0]);
  const opacity = interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" });

  // 放在安全区底部之上:字幕带高度(captionsReserve)再往上留一截
  const bottomOffset = (safeArea.bottom ?? 60) + captionsReserve + size.body * 0.5;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: safeArea.left ?? 60,
          bottom: bottomOffset,
          maxWidth: width - (safeArea.left ?? 60) - (safeArea.right ?? 60),
          opacity,
          transform: `translateX(${x}px)`,
          display: "flex",
          flexDirection: "column",
          gap: size.small * 0.3,
        }}
      >
        <div
          style={{
            ...GLOBAL_TEXT_STYLE,
            alignSelf: "flex-start",
            padding: `${size.h3 * 0.28}px ${size.body * 0.7}px`,
            borderRadius: size.small * 0.4,
            borderLeft: `${Math.max(6, size.body * 0.18)}px solid ${accent(0)}`,
            background: withAlpha(palette.bg, 0.78),
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: size.h3,
            lineHeight: 1.1,
            color: palette.fg,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              ...GLOBAL_TEXT_STYLE,
              alignSelf: "flex-start",
              padding: `${size.small * 0.25}px ${size.body * 0.7}px`,
              borderRadius: size.small * 0.4,
              background: withAlpha(accent(0), 0.9),
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: size.small,
              color: palette.bg,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
