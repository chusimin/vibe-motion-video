// Title —— 标题镜:产品名/大标题 + 副标题,居中大字,克制入场。
import React from "react";
import { useCurrentFrame } from "remotion";
import { SafeFrame, useEnter } from "../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../fonts.js";

export default function Title({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const { motion, size, fonts, palette, accent } = theme;
  const title = scene.onScreenText || scene.visual?.value || scene.purpose || "";
  const subtitle = scene.visual?.subtitle || scene.vo || "";

  const titleAnim = useEnter({ delay: 4, motion, distance: motion.enterShiftPx });
  const subAnim = useEnter({ delay: 14, motion, distance: motion.enterShiftPx * 0.6 });

  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve}>
      <div
        style={{
          ...titleAnim,
          ...GLOBAL_TEXT_STYLE,
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: size.h1,
          lineHeight: 1.06,
          letterSpacing: "-0.02em",
          color: palette.fg,
          textAlign: "center",
          maxWidth: "100%",
          textWrap: "balance",
        }}
      >
        {title}
      </div>
      {subtitle ? (
        <div
          style={{
            ...subAnim,
            ...GLOBAL_TEXT_STYLE,
            marginTop: size.h3 * 0.7,
            fontFamily: fonts.body,
            fontWeight: 500,
            fontSize: size.h3,
            lineHeight: 1.3,
            color: accent(0),
            textAlign: "center",
            maxWidth: "92%",
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </SafeFrame>
  );
}
