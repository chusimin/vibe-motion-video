// Comparison —— 前后/优劣对比:上下两块(竖屏),左旧右新或上"前"下"后"。
// 数据来源:visual.items=[左/前, 右/后] 或 visual.before/after;标题用 onScreenText。
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { SafeFrame, useEnter } from "../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../fonts.js";
import { withAlpha } from "../theme.js";

function Panel({ tag, text, color, theme, anim }) {
  const { size, fonts, palette } = theme;
  return (
    <div
      style={{
        ...anim,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: size.body * 0.5,
        padding: `${size.h3 * 0.7}px ${size.body * 0.8}px`,
        borderRadius: size.body * 0.7,
        background: withAlpha(color, 0.14),
        border: `2px solid ${withAlpha(color, 0.4)}`,
      }}
    >
      <div
        style={{
          ...GLOBAL_TEXT_STYLE,
          alignSelf: "flex-start",
          padding: `${size.small * 0.25}px ${size.small * 0.6}px`,
          borderRadius: 999,
          background: color,
          color: palette.bg,
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: size.small,
        }}
      >
        {tag}
      </div>
      <div
        style={{
          ...GLOBAL_TEXT_STYLE,
          fontFamily: fonts.body,
          fontWeight: 700,
          fontSize: size.h3,
          lineHeight: 1.2,
          color: palette.fg,
        }}
      >
        {text}
      </div>
    </div>
  );
}

export default function Comparison({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const { motion, size, fonts, palette, accent } = theme;
  const v = scene.visual || {};
  const items = Array.isArray(v.items) ? v.items : [];
  const before = v.before ?? items[0] ?? "之前";
  const after = v.after ?? items[1] ?? "之后";
  const beforeTag = v.beforeTag || "Before";
  const afterTag = v.afterTag || "After";
  const heading = scene.onScreenText || "";

  const headAnim = useEnter({ delay: 2, motion });
  const aAnim = useEnter({ delay: 8, motion, axis: "x", distance: -motion.enterShiftPx, from: -1 });
  const bAnim = useEnter({ delay: 14, motion, axis: "x", distance: motion.enterShiftPx });

  return (
    <SafeFrame safeArea={safeArea} align="stretch" extraBottom={captionsReserve}>
      {heading ? (
        <div
          style={{
            ...headAnim,
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: size.h2,
            lineHeight: 1.1,
            color: palette.fg,
            textAlign: "center",
            marginBottom: size.h3 * 0.8,
          }}
        >
          {heading}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: size.body * 0.7, flex: 1, maxHeight: "62%" }}>
        <Panel tag={beforeTag} text={before} color="#8A8A8E" theme={theme} anim={aAnim} />
        <Panel tag={afterTag} text={after} color={accent(0)} theme={theme} anim={bAnim} />
      </div>
    </SafeFrame>
  );
}
