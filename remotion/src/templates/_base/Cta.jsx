// Cta —— 行动召唤:大标题 + 行动按钮(网址/搜索词)+ 可选品牌定格。
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { SafeFrame, useEnter, usePopIn } from "../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../fonts.js";
import { withAlpha } from "../theme.js";

export default function Cta({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion, size, fonts, palette, accent } = theme;
  const v = scene.visual || {};
  const headline = scene.onScreenText || "现在就开始";
  const action = v.value || v.action || v.url || "";

  const headAnim = useEnter({ delay: 2, motion });
  const btn = usePopIn({ delay: 14, motion });
  // 按钮持续轻微脉动,引导点击
  const pulse = 1 + 0.02 * Math.sin((frame / fps) * Math.PI * 2 * 0.6);

  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve}>
      <div
        style={{
          ...headAnim,
          ...GLOBAL_TEXT_STYLE,
          fontFamily: fonts.display,
          fontWeight: 900,
          fontSize: size.h1,
          lineHeight: 1.06,
          letterSpacing: "-0.02em",
          color: palette.fg,
          textAlign: "center",
          textWrap: "balance",
          marginBottom: action ? size.h2 * 0.8 : 0,
        }}
      >
        {headline}
      </div>
      {action ? (
        <div
          style={{
            opacity: btn.opacity,
            transform: `scale(${btn.scale * pulse})`,
            padding: `${size.body * 0.6}px ${size.h2 * 0.7}px`,
            borderRadius: 999,
            background: accent(0),
            color: palette.bg,
            boxShadow: `0 12px 48px ${withAlpha(accent(0), 0.5)}`,
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: size.h3,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
          }}
        >
          {action}
        </div>
      ) : null}
    </SafeFrame>
  );
}
