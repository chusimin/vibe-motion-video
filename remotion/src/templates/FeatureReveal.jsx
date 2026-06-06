// FeatureReveal —— 功能逐项揭示:标题 + 一组特性卡片依次展开(带图标占位/编号)。
// 与 BulletList 区别:卡片化、强调"逐项动效展开",更适合功能亮点段。
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { SafeFrame, useEnter } from "../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../fonts.js";
import { withAlpha } from "../theme.js";

export default function FeatureReveal({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion, size, fonts, palette, accent } = theme;
  const heading = scene.onScreenText || "";
  const items = Array.isArray(scene.visual?.items) ? scene.visual.items : [];
  const headAnim = useEnter({ delay: 2, motion });

  return (
    <SafeFrame safeArea={safeArea} align="stretch" justify="center" extraBottom={captionsReserve}>
      {heading ? (
        <div
          style={{
            ...headAnim,
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: size.h2,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: palette.fg,
            marginBottom: size.h3,
            textAlign: "left",
          }}
        >
          {heading}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: size.body * 0.55 }}>
        {items.map((it, i) => {
          const delay = 10 + i * 8;
          const s = spring({ frame: frame - delay, fps, config: { damping: 18, mass: motion.mass, stiffness: 140 } });
          const x = interpolate(s, [0, 1], [motion.enterShiftPx, 0]);
          const opacity = interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" });
          const ac = accent(i % 3);
          return (
            <div
              key={i}
              style={{
                opacity,
                transform: `translateX(${x}px)`,
                display: "flex",
                alignItems: "center",
                gap: size.body * 0.6,
                padding: `${size.body * 0.55}px ${size.body * 0.7}px`,
                borderRadius: size.body * 0.5,
                background: withAlpha(ac, 0.12),
                border: `2px solid ${withAlpha(ac, 0.35)}`,
              }}
            >
              <div
                style={{
                  flex: "0 0 auto",
                  width: size.h3,
                  height: size.h3,
                  borderRadius: size.h3 * 0.28,
                  background: ac,
                  color: palette.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: fonts.display,
                  fontWeight: 900,
                  fontSize: size.h3 * 0.55,
                  ...GLOBAL_TEXT_STYLE,
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  ...GLOBAL_TEXT_STYLE,
                  fontFamily: fonts.body,
                  fontWeight: 600,
                  fontSize: size.body,
                  lineHeight: 1.25,
                  color: palette.fg,
                }}
              >
                {it}
              </div>
            </div>
          );
        })}
      </div>
    </SafeFrame>
  );
}
