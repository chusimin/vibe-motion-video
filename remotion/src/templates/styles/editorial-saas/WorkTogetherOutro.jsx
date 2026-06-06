// WorkTogetherOutro —— 覆盖 cta。editorial-saas 的品牌落点:
// 干净落版,onScreenText 做描边 pill / lockup(对标 ObiN「Let's Work Together」描边胶囊),
// 亮底大留白,可带小 sparkle 四角星点缀;副文案作极小弱化免责/网址行。
//
// props 与 _base/Cta.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
//   scene.onScreenText = 主文案(pill 内);scene.visual.value/action/url = 副行(网址/署名)。
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SafeFrame } from "../../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { withAlpha } from "../../../theme.js";
import { smoothSpring } from "./_shared.jsx";

// 四角星 sparkle（CSS 凹四边形，呼应 ObiN 紫色四角星元素）。
function Sparkle({ size, color, style }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: color,
        // 内凹四角星：用 radial 蒙版近似的简单实现——这里用 clip-path 星形
        clipPath:
          "polygon(50% 0%, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0% 50%, 40% 40%)",
        ...style,
      }}
    />
  );
}

export default function WorkTogetherOutro({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion, size, fonts, palette, accent } = theme;
  const v = scene.visual || {};
  const headline = scene.onScreenText || "Let's Work Together";
  const sub = v.value || v.action || v.url || "";

  // pill 入场：轻 scale + 升入。
  const pillS = smoothSpring({ frame, fps, delay: 4, motion: { ...motion, overshoot: true } });
  const pillScale = 0.9 + 0.1 * clamp01(pillS);
  const pillOpacity = clamp01(pillS * 1.4);

  // 副行更晚、更弱。
  const subS = smoothSpring({ frame, fps, delay: 18, motion });

  // sparkle 轻微自转 + 呼吸。
  const spin = (frame / fps) * 40; // 慢转
  const breathe = 1 + 0.08 * Math.sin((frame / fps) * Math.PI * 2 * 0.5);

  const pillPadV = Math.round(size.h3 * 0.62);
  const pillPadH = Math.round(size.h1 * 0.5);

  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve} justify={justify}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* 描边 pill */}
        <div
          style={{
            position: "relative",
            opacity: pillOpacity,
            transform: `scale(${pillScale})`,
            padding: `${pillPadV}px ${pillPadH}px`,
            borderRadius: 999,
            border: `${Math.max(2, Math.round(size.small * 0.08))}px solid ${accent(0)}`,
            background: "transparent",
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: size.h2,
            letterSpacing: "-0.01em",
            color: palette.fg,
            whiteSpace: "nowrap",
          }}
        >
          {headline}
          {/* 右上角小 sparkle 点缀 */}
          <div
            style={{
              position: "absolute",
              top: `-${Math.round(size.h2 * 0.22)}px`,
              right: `-${Math.round(size.h2 * 0.18)}px`,
              transform: `rotate(${spin}deg) scale(${breathe})`,
              opacity: pillOpacity,
            }}
          >
            <Sparkle size={Math.round(size.h3 * 0.7)} color={accent(0)} />
          </div>
        </div>

        {/* 副行：极小、弱化、居中 */}
        {sub ? (
          <div
            style={{
              marginTop: Math.round(size.h2 * 0.7),
              opacity: clamp01(subS) * 0.55,
              transform: `translateY(${(1 - subS) * 12}px)`,
              ...GLOBAL_TEXT_STYLE,
              fontFamily: fonts.body,
              fontWeight: 500,
              fontSize: size.small,
              lineHeight: 1.4,
              letterSpacing: "0.04em",
              color: palette.fg,
              textAlign: "center",
              maxWidth: "78%",
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </SafeFrame>
  );
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
